package service

import (
	"bytes"
	"compress/zlib"
	"encoding/hex"
	"errors"
	"io"
	"strings"
)

// QQ 音乐歌词（QRC 逐字、音译）的解密：正文为十六进制密文，解密后是 zlib 压缩的文本。
// 加密算法是 QQ 音乐客户端自己的三重 DES 变体（ECB，密钥固定），与标准 DES 有三处不同，因此不能使用 crypto/des：
//   - 读写 8 字节分组与密钥时，每 4 字节按小端顺序取位
//   - S 盒有两个条目与标准不同（S2 第 1 行第 7 列为 15，S4 第 3 行第 5 列为 10）
//   - 子密钥压缩置换（PC-2）取 D 半部分时位置整体后移一位
// 下面按 FIPS 46-3 的结构实现，只在上述三处做调整

var qrcKey = []byte("!@#)(*$%123ZXC!@!@#)(NHL")

const (
	qrcEncrypt = iota
	qrcDecrypt
)

// 初始置换（0 起，最高位为 0）；逆初始置换由它求逆得到
var qrcIP = func() [64]int {
	var table [64]int
	i := 0
	for _, start := range []int{57, 59, 61, 63, 56, 58, 60, 62} {
		for step := 0; step < 8; step++ {
			table[i] = start - step*8
			i++
		}
	}
	return table
}()

var qrcExpansion = [48]int{
	31, 0, 1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 7, 8, 9, 10, 11, 12, 11, 12, 13, 14, 15, 16,
	15, 16, 17, 18, 19, 20, 19, 20, 21, 22, 23, 24, 23, 24, 25, 26, 27, 28, 27, 28, 29, 30, 31, 0,
}

var qrcPBox = [32]int{15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24}

var qrcPC1 = [56]int{
	56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
	62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3,
}

var qrcPC2 = [48]int{
	13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
	40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
}

var qrcRotations = [16]int{1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1}

// S 盒按「行 × 16 + 列」排列
var qrcSBoxes = func() [8][64]uint32 {
	boxes := [8][64]uint32{
		{14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
			4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13},
		{15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
			0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9},
		{10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
			13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12},
		{7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
			10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14},
		{2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
			4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3},
		{12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
			9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13},
		{4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
			1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12},
		{13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
			7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11},
	}
	// QQ 音乐的两处改动
	boxes[1][1*16+7] = 15
	boxes[3][3*16+5] = 10
	return boxes
}()

// qrcBit 取分组第 b 位（0 为最高位）：每 4 字节按小端顺序排列
func qrcBit(block []byte, b int) uint32 {
	return uint32(block[b/32*4+3-b%32/8]>>(7-b%8)) & 1
}

func qrcSetBit(block []byte, b int, v uint32) {
	block[b/32*4+3-b%32/8] |= byte(v << (7 - b%8))
}

// qrcSchedule 16 轮的 48 位子密钥（存于 uint64 的低 48 位）；解密时逆序
func qrcSchedule(key []byte, mode int) [16]uint64 {
	var c, d uint32
	for i := 0; i < 28; i++ {
		c |= qrcBit(key, qrcPC1[i]) << (31 - i)
		d |= qrcBit(key, qrcPC1[28+i]) << (31 - i)
	}
	var schedule [16]uint64
	for round := 0; round < 16; round++ {
		// C、D 各 28 位存于高位，循环左移
		s := qrcRotations[round]
		c = (c<<s | c>>(28-s)) & 0xfffffff0
		d = (d<<s | d>>(28-s)) & 0xfffffff0
		var sub uint64
		for j := 0; j < 48; j++ {
			var bit uint32
			if j < 24 {
				bit = c >> (31 - qrcPC2[j]) & 1
			} else {
				// QQ 音乐的改动：D 半部分的位置后移一位
				bit = d >> (31 - (qrcPC2[j] - 27)) & 1
			}
			sub |= uint64(bit) << (47 - j)
		}
		if mode == qrcDecrypt {
			schedule[15-round] = sub
		} else {
			schedule[round] = sub
		}
	}
	return schedule
}

func qrcFeistel(r uint32, sub uint64) uint32 {
	var e uint64
	for i, src := range qrcExpansion {
		e |= uint64(r>>(31-src)&1) << (47 - i)
	}
	x := e ^ sub
	var out uint32
	for s := 0; s < 8; s++ {
		six := uint32(x>>(42-6*s)) & 0x3f
		row := six>>4&2 | six&1
		col := six >> 1 & 0xf
		out |= qrcSBoxes[s][row*16+col] << (28 - 4*s)
	}
	var p uint32
	for i, src := range qrcPBox {
		p |= (out >> (31 - src) & 1) << (31 - i)
	}
	return p
}

// qrcCrypt 单次 DES：最后一轮不交换左右两半
func qrcCrypt(block []byte, schedule *[16]uint64) {
	var l, r uint32
	for k := 0; k < 32; k++ {
		l |= qrcBit(block, qrcIP[k]) << (31 - k)
		r |= qrcBit(block, qrcIP[32+k]) << (31 - k)
	}
	for round := 0; round < 15; round++ {
		l, r = r, qrcFeistel(r, schedule[round])^l
	}
	l ^= qrcFeistel(r, schedule[15])

	var out [8]byte
	for k := 0; k < 64; k++ {
		v := l
		if k >= 32 {
			v = r
		}
		qrcSetBit(out[:], qrcIP[k], v>>(31-k%32)&1)
	}
	copy(block, out[:])
}

// qrcTripleSchedules 三重 DES（EDE）的三组子密钥：解密时密钥顺序与模式均反过来
func qrcTripleSchedules(mode int) [3][16]uint64 {
	other := qrcDecrypt
	if mode == qrcDecrypt {
		other = qrcEncrypt
		return [3][16]uint64{qrcSchedule(qrcKey[16:24], mode), qrcSchedule(qrcKey[8:16], other), qrcSchedule(qrcKey[0:8], mode)}
	}
	return [3][16]uint64{qrcSchedule(qrcKey[0:8], mode), qrcSchedule(qrcKey[8:16], other), qrcSchedule(qrcKey[16:24], mode)}
}

var (
	qrcDecryptSchedules = qrcTripleSchedules(qrcDecrypt)
	qrcEncryptSchedules = qrcTripleSchedules(qrcEncrypt)
)

func qrcCipher(data []byte, schedules *[3][16]uint64) {
	for i := 0; i+8 <= len(data); i += 8 {
		for j := range schedules {
			qrcCrypt(data[i:i+8], &schedules[j])
		}
	}
}

// qrcMaxBytes 解压后的歌词文本上限
const qrcMaxBytes = 2 << 20

// decryptQRC 解密 QQ 音乐的歌词密文（十六进制）并解压；空串返回空串
func decryptQRC(cipherHex string) (string, error) {
	cipherHex = strings.TrimSpace(cipherHex)
	if cipherHex == "" {
		return "", nil
	}
	data, err := hex.DecodeString(cipherHex)
	if err != nil {
		return "", err
	}
	if len(data)%8 != 0 {
		return "", errors.New("qrc: ciphertext is not a multiple of the block size")
	}
	qrcCipher(data, &qrcDecryptSchedules)
	reader, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	defer reader.Close()
	text, err := io.ReadAll(io.LimitReader(reader, qrcMaxBytes+1))
	if err != nil {
		return "", err
	}
	if len(text) > qrcMaxBytes {
		return "", errors.New("qrc: lyric too large")
	}
	return strings.TrimPrefix(string(text), "\ufeff"), nil
}

// encryptQRC 解密的逆过程（压缩后加密为十六进制），仅用于测试
func encryptQRC(text string) string {
	var buf bytes.Buffer
	w := zlib.NewWriter(&buf)
	_, _ = w.Write([]byte(text))
	_ = w.Close()
	data := buf.Bytes()
	if pad := len(data) % 8; pad != 0 {
		data = append(data, make([]byte, 8-pad)...)
	}
	qrcCipher(data, &qrcEncryptSchedules)
	return strings.ToUpper(hex.EncodeToString(data))
}
