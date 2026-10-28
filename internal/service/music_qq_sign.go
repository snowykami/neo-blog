package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// QQ 音乐桌面客户端的歌曲搜索（见 docs/music-player-spec.md 7.2a）：网页的公开搜索接口（client_search_cp）基本只返回 500，
// 联想搜索最多只有几条结果；客户端搜索（music.search.SearchCgiService.DoSearchForQQMusicDesktop）一次返回完整结果，
// 但必须以客户端身份发往 musics.fcg 并带签名，否则返回 2001。签名按协议实现（参考 StarryPlayer 的协议说明，代码自行编写）：
//   - Sign = base64(12 个随机大写字母 + HMAC-SHA1(协议密钥, 反转后的 base64(请求体)))
//   - Mask = base64(QQTEA(「ct&cv&&uin&时间戳&uid&」, Sign 的前 8 个与后 8 个字符))
//   - 请求的 comm 带客户端会话（GetSession 取得的 uid / sid，缓存 1 小时）与设备 ID

const (
	musicQQClientCT        = "6"
	musicQQClientCV        = "111000"
	musicQQClientUserAgent = "QQMusic/73282 CFNetwork/3860.100.1 Darwin/25.0.0"
	musicQQClientReferer   = "http://y.qq.com"
	// 协议固定的签名密钥（客户端协议的一部分）
	musicQQSignKey = "9FF169D646A3"
	// 网络错误与超时的重试次数（间隔 0.3 秒、0.6 秒）
	musicQQClientRetries   = 2
	musicQQSessionTTL      = time.Hour
	musicQQDesktopPageSize = 20
)

var (
	// 客户端 CGI 的地址与重试间隔（测试时替换）
	musicQQClientHost       = "https://u6.y.qq.com/cgi-bin/"
	musicQQClientRetryDelay = 300 * time.Millisecond
	// 设备 ID：40 位十六进制，进程内固定
	musicQQDeviceID = func() string {
		b := make([]byte, 20)
		_, _ = rand.Read(b)
		return hex.EncodeToString(b)
	}()
	musicQQSession struct {
		sync.Mutex
		uid, sid string
		expires  time.Time
	}
	musicQQSessionGroup singleflight.Group
)

// ---------- QQ TEA ----------

const (
	qqTEADelta = 0x9e3779b9
	// 解密的初始 sum：delta × 16（按 32 位截断）
	qqTEADecryptSum = 0xe3779b90
)

func qqTEAKey(key []byte) [4]uint32 {
	var k [4]uint32
	for i := range k {
		k[i] = binary.BigEndian.Uint32(key[i*4:])
	}
	return k
}

// qqTEAEncryptBlock 标准 TEA 加密一块（16 轮，大端序）
func qqTEAEncryptBlock(y, z uint32, k [4]uint32) (uint32, uint32) {
	var sum uint32
	for range 16 {
		sum += qqTEADelta
		y += ((z << 4) + k[0]) ^ (z + sum) ^ ((z >> 5) + k[1])
		z += ((y << 4) + k[2]) ^ (y + sum) ^ ((y >> 5) + k[3])
	}
	return y, z
}

func qqTEADecryptBlock(y, z uint32, k [4]uint32) (uint32, uint32) {
	sum := uint32(qqTEADecryptSum)
	for range 16 {
		z -= ((y << 4) + k[2]) ^ (y + sum) ^ ((y >> 5) + k[3])
		y -= ((z << 4) + k[0]) ^ (z + sum) ^ ((z >> 5) + k[1])
		sum -= qqTEADelta
	}
	return y, z
}

// qqTEAEncrypt QQ 协议的 TEA：首字节低 3 位为填充长度，随后是填充与 2 个随机字节、数据、7 个零字节；
// 每块先与上一块密文异或再加密，结果再与上一块（异或后的）明文异或
func qqTEAEncrypt(data, key []byte, random io.Reader) []byte {
	k := qqTEAKey(key)
	pad := (8 - (len(data)+10)%8) % 8
	noise := make([]byte, pad+3)
	_, _ = io.ReadFull(random, noise)
	plain := make([]byte, 1+pad+2+len(data)+7)
	plain[0] = (noise[0] & 0xf8) | byte(pad)
	copy(plain[1:pad+3], noise[1:])
	copy(plain[pad+3:], data)
	out := make([]byte, len(plain))
	var prevPlainH, prevPlainL, prevCipherH, prevCipherL uint32
	for offset := 0; offset < len(plain); offset += 8 {
		xh := binary.BigEndian.Uint32(plain[offset:]) ^ prevCipherH
		xl := binary.BigEndian.Uint32(plain[offset+4:]) ^ prevCipherL
		eh, el := qqTEAEncryptBlock(xh, xl, k)
		ch, cl := eh^prevPlainH, el^prevPlainL
		binary.BigEndian.PutUint32(out[offset:], ch)
		binary.BigEndian.PutUint32(out[offset+4:], cl)
		prevPlainH, prevPlainL, prevCipherH, prevCipherL = xh, xl, ch, cl
	}
	return out
}

// qqTEADecrypt qqTEAEncrypt 的逆运算（只用于测试校验）
func qqTEADecrypt(data, key []byte) ([]byte, error) {
	if len(data) < 16 || len(data)%8 != 0 {
		return nil, errors.New("tea: bad length")
	}
	k := qqTEAKey(key)
	plain := make([]byte, len(data))
	var prevPlainH, prevPlainL, prevCipherH, prevCipherL uint32
	for offset := 0; offset < len(data); offset += 8 {
		ch := binary.BigEndian.Uint32(data[offset:])
		cl := binary.BigEndian.Uint32(data[offset+4:])
		xh, xl := qqTEADecryptBlock(ch^prevPlainH, cl^prevPlainL, k)
		binary.BigEndian.PutUint32(plain[offset:], xh^prevCipherH)
		binary.BigEndian.PutUint32(plain[offset+4:], xl^prevCipherL)
		prevPlainH, prevPlainL, prevCipherH, prevCipherL = xh, xl, ch, cl
	}
	pad := int(plain[0] & 7)
	end := len(plain) - 7
	if pad+3 > end || !bytes.Equal(plain[end:], make([]byte, 7)) {
		return nil, errors.New("tea: bad padding")
	}
	return plain[pad+3 : end], nil
}

// ---------- 签名 ----------

// qqSign 客户端请求的 Sign 与 Mask 请求头
func qqSign(body []byte, uid string, now time.Time, random io.Reader) (sign, mask string) {
	encoded := []byte(base64.StdEncoding.EncodeToString(body))
	for i, j := 0, len(encoded)-1; i < j; i, j = i+1, j-1 {
		encoded[i], encoded[j] = encoded[j], encoded[i]
	}
	mac := hmac.New(sha1.New, []byte(musicQQSignKey))
	mac.Write(encoded)
	signature := make([]byte, 12, 32)
	_, _ = io.ReadFull(random, signature)
	for i := range signature {
		signature[i] = 'A' + signature[i]%26
	}
	signature = append(signature, mac.Sum(nil)...)
	sign = base64.StdEncoding.EncodeToString(signature)

	header := fmt.Sprintf("%s&%s&&&%d&%s&", musicQQClientCT, musicQQClientCV, now.Unix(), uid)
	key := append([]byte(sign[:8]), sign[len(sign)-8:]...)
	mask = base64.StdEncoding.EncodeToString(qqTEAEncrypt([]byte(header), key, random))
	return sign, mask
}

// ---------- 客户端请求 ----------

// qqClientComm 请求的 comm：客户端身份、会话与设备 ID
func qqClientComm(uid, sid string) map[string]string {
	return map[string]string{
		"ct": musicQQClientCT, "cv": musicQQClientCV, "uid": uid, "sid": sid, "OpenUDID": musicQQDeviceID,
		"gray": "1", "patch": "1", "nettype": "2", "qq": "0", "tmeAppID": "qqmusic", "authst": "",
	}
}

// qqClientPost 以客户端身份请求一个 CGI，返回 req 的 data；网络错误与超时重试，CGI 返回非 0 时报错
func qqClientPost(ctx context.Context, module, method string, param map[string]any, signed bool, uid, sid string) (json.RawMessage, error) {
	body, _ := json.Marshal(map[string]any{
		"comm": qqClientComm(uid, sid),
		"req":  map[string]any{"module": module, "method": method, "param": param},
	})
	endpoint := musicQQClientHost + "musicu.fcg"
	if signed {
		endpoint = musicQQClientHost + "musics.fcg"
	}
	var lastErr error
	for attempt := 0; attempt <= musicQQClientRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(attempt) * musicQQClientRetryDelay):
			}
		}
		data, retry, err := qqClientPostOnce(ctx, endpoint, body, signed, uid)
		if err == nil {
			return qqClientData(data, module+"."+method)
		}
		lastErr = err
		if !retry {
			break
		}
	}
	return nil, lastErr
}

// qqClientPostOnce 发送一次请求；retry 表示网络错误、超时或 5xx，可以重试
func qqClientPostOnce(ctx context.Context, endpoint string, body []byte, signed bool, uid string) (data []byte, retry bool, err error) {
	reqCtx, cancel := context.WithTimeout(ctx, musicRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", musicQQClientUserAgent)
	req.Header.Set("Referer", musicQQClientReferer)
	if signed {
		sign, mask := qqSign(body, uid, time.Now(), rand.Reader)
		req.Header.Set("Sign", sign)
		req.Header.Set("Mask", mask)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, true, err
	}
	defer resp.Body.Close()
	data, err = io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, true, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode >= 500, fmt.Errorf("qq client: status %d", resp.StatusCode)
	}
	return data, false, nil
}

// qqClientData 回复中 req 的 data；整体或 req 的 code 不为 0 时报错
func qqClientData(data []byte, name string) (json.RawMessage, error) {
	var answer struct {
		Code int `json:"code"`
		Req  struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		} `json:"req"`
	}
	if err := json.Unmarshal(data, &answer); err != nil {
		return nil, fmt.Errorf("%s: invalid response", name)
	}
	if answer.Code != 0 {
		return nil, fmt.Errorf("%s: code %d", name, answer.Code)
	}
	if answer.Req.Code != 0 {
		return nil, fmt.Errorf("%s: code %d", name, answer.Req.Code)
	}
	return answer.Req.Data, nil
}

// qqClientSession 客户端会话（uid / sid），缓存 1 小时；取不到时返回空值（签名请求仍可能成功）
func qqClientSession(ctx context.Context) (uid, sid string) {
	musicQQSession.Lock()
	if time.Now().Before(musicQQSession.expires) {
		uid, sid = musicQQSession.uid, musicQQSession.sid
		musicQQSession.Unlock()
		return uid, sid
	}
	musicQQSession.Unlock()
	value, _, _ := musicQQSessionGroup.Do("session", func() (any, error) {
		data, err := qqClientPost(context.WithoutCancel(ctx), "music.getSession.session", "GetSession", map[string]any{"uid": "", "vkey": 0, "caller": 0}, false, "", "")
		if err != nil {
			return [2]string{}, nil
		}
		var info struct {
			Session struct {
				UID string `json:"uid"`
				SID string `json:"sid"`
			} `json:"session"`
		}
		if json.Unmarshal(data, &info) != nil || info.Session.UID == "" {
			return [2]string{}, nil
		}
		musicQQSession.Lock()
		musicQQSession.uid, musicQQSession.sid, musicQQSession.expires = info.Session.UID, info.Session.SID, time.Now().Add(musicQQSessionTTL)
		musicQQSession.Unlock()
		return [2]string{info.Session.UID, info.Session.SID}, nil
	})
	pair, _ := value.([2]string)
	return pair[0], pair[1]
}

// searchQQSongsDesktop 客户端歌曲搜索（带签名），一次返回带时长、专辑与歌手的完整结果
func searchQQSongsDesktop(ctx context.Context, keyword string) ([]lyricCandidate, error) {
	uid, sid := qqClientSession(ctx)
	searchID, _ := rand.Int(rand.Reader, big.NewInt(1e15))
	data, err := qqClientPost(ctx, "music.search.SearchCgiService", "DoSearchForQQMusicDesktop", map[string]any{
		"searchid":     strconv.FormatInt(time.Now().UnixNano(), 10) + searchID.String(),
		"search_type":  0,
		"query":        keyword,
		"page_num":     1,
		"num_per_page": musicQQDesktopPageSize,
		"nqc_flag":     0,
		"remoteplace":  "txt.mac.search",
		"grp":          1,
	}, true, uid, sid)
	if err != nil {
		return nil, fmt.Errorf("desktop search: %w", err)
	}
	type named struct {
		Title string `json:"title"`
		Name  string `json:"name"`
	}
	pick := func(n named) string {
		if n.Title != "" {
			return n.Title
		}
		return n.Name
	}
	var result struct {
		Body struct {
			Song struct {
				List []struct {
					MID      string  `json:"mid"`
					Title    string  `json:"title"`
					Name     string  `json:"name"`
					Interval float64 `json:"interval"` // 秒
					Album    named   `json:"album"`
					Singer   []named `json:"singer"`
				} `json:"list"`
			} `json:"song"`
		} `json:"body"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("desktop search: %w", err)
	}
	candidates := make([]lyricCandidate, 0, len(result.Body.Song.List))
	for _, song := range result.Body.Song.List {
		title := pick(named{Title: song.Title, Name: song.Name})
		if song.MID == "" || title == "" {
			continue
		}
		artists := make([]string, 0, len(song.Singer))
		for _, singer := range song.Singer {
			if name := pick(singer); name != "" {
				artists = append(artists, name)
			}
		}
		candidates = append(candidates, lyricCandidate{MID: song.MID, Title: title, Artists: artists, Album: pick(song.Album), Duration: song.Interval})
	}
	return candidates, nil
}
