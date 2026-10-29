package service

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
)

// 自定义粒子（见 docs/music-player-spec.md 7.2m）：歌词里有内置粒子场景表达不了的具体意象时，全曲规划定义最多 2 种粒子：
// 优先从精选图标库（lucide 中适合做粒子的 223 个图标，按类别列在提示词里）选一个；都不合适时只描述意象，
// 由一次单独的「画图标」请求画出 24×24 的简单剪影（与逐段标注并行，不增加总耗时）。图标与路径都经过严格校验，
// 不合格的粒子丢弃，用到它的行改用模型给的内置场景。前端只在粒子画布上用 Path2D 绘制，不往页面插入 SVG

//go:embed lyric_sprite_icons.json
var lyricSpriteIconsJSON []byte

const (
	lyricSpriteMax         = 2
	lyricSpriteMaxPaths    = 4
	lyricSpriteMaxPathLen  = 600
	lyricSpriteMaxNumbers  = 160
	lyricSpriteMaxLabel    = 20
	lyricSpriteDefaultSize = "m"
	// 模型没给颜色或颜色无效时的默认色（偏中性的浅色）
	lyricSpriteDefaultColor = "moonlight"
)

// lyricSpriteIconData 精选图标库：类别（提示词中的清单）与每个图标的路径
type lyricSpriteIconData struct {
	Categories []struct {
		Key   string   `json:"key"`
		Icons []string `json:"icons"`
	} `json:"categories"`
	Icons map[string][]string `json:"icons"`
}

var (
	// 作为包级变量初始化（而不是在 init 中）：提示词在包级变量初始化时就要用到图标清单，Go 按依赖顺序先初始化它
	lyricSpriteLibrary  = loadLyricSpriteIcons()
	lyricSpriteIcons    = lyricSpriteLibrary.Icons
	lyricSpriteMotions  = map[string]bool{"fall": true, "float": true, "drift": true, "sway": true, "swirl": true, "burst": true}
	lyricSpriteSizes    = map[string]bool{"s": true, "m": true, "l": true}
	lyricSpritePaints   = map[string]bool{"fill": true, "light": true, "stroke": true}
	lyricSpriteNameRe   = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,23}$`)
	lyricSpritePathRe   = regexp.MustCompile(`^M[MLHVCQAZ0-9\s,.\-]*$`)
	lyricSpriteNumberRe = regexp.MustCompile(`-?\d*\.?\d+`)
)

func loadLyricSpriteIcons() lyricSpriteIconData {
	var data lyricSpriteIconData
	if err := json.Unmarshal(lyricSpriteIconsJSON, &data); err != nil {
		panic("invalid lyric_sprite_icons.json: " + err.Error())
	}
	return data
}

// lyricSpriteIconList 提示词中的图标清单：每类一行「类别: 图标, 图标, …」
func lyricSpriteIconList() string {
	var b strings.Builder
	for _, category := range lyricSpriteLibrary.Categories {
		b.WriteString(category.Key + ": " + strings.Join(category.Icons, ", ") + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// lyricSpriteRequest 规划中的一个自定义粒子（模型的输出，未校验）；paths 为画图标请求的结果，在生成流程中填入
type lyricSpriteRequest struct {
	Name     string `json:"name"`
	Image    string `json:"image"`
	Icon     string `json:"icon"`
	Motion   string `json:"motion"`
	Size     string `json:"size"`
	Spin     bool   `json:"spin"`
	Color    string `json:"color"`
	Fallback string `json:"fallback"`
	Paths    []struct {
		D     string `json:"d"`
		Paint string `json:"paint"`
	} `json:"paths"`
}

// needsDrawing 规划没有选图标库里的图标（或选了不存在的）时需要画
func (r lyricSpriteRequest) needsDrawing() bool {
	return lyricSpriteIcons[r.Icon] == nil && strings.TrimSpace(r.Image) != ""
}

// validLyricSpritePath 模型画的路径：以 M 开头，只含绝对坐标的 M L H V C Q A Z 与数字，数字在画布（0～24，留 1 的余量）内，长度与数量有上限
func validLyricSpritePath(d string) bool {
	d = strings.TrimSpace(d)
	if d == "" || len(d) > lyricSpriteMaxPathLen || !lyricSpritePathRe.MatchString(d) {
		return false
	}
	numbers := lyricSpriteNumberRe.FindAllString(d, -1)
	if len(numbers) == 0 || len(numbers) > lyricSpriteMaxNumbers {
		return false
	}
	for _, number := range numbers {
		value, err := strconv.ParseFloat(number, 64)
		if err != nil || value < -1 || value > 25 {
			return false
		}
	}
	return true
}

// sanitizeLyricSprites 校验规划中的自定义粒子：名称合法且不重复，图标来自图标库（路径取自图标库）或路径通过校验；
// 动作、尺寸、颜色取允许的值（无效时用默认值），最多 lyricSpriteMax 种。返回通过的粒子，以及每个粒子（含被丢弃的）的备用内置场景
func sanitizeLyricSprites(requests []lyricSpriteRequest) ([]dto.MusicLyricSprite, map[string]string) {
	sprites := []dto.MusicLyricSprite{}
	fallbacks := map[string]string{}
	for _, request := range requests {
		name := strings.ToLower(strings.TrimSpace(request.Name))
		if !lyricSpriteNameRe.MatchString(name) {
			continue
		}
		if _, seen := fallbacks[name]; seen {
			continue
		}
		fallbacks[name] = ""
		if lyricAnnotationScenes[request.Fallback] {
			fallbacks[name] = request.Fallback
		}
		if len(sprites) >= lyricSpriteMax {
			continue
		}
		sprite := dto.MusicLyricSprite{Name: name, Motion: request.Motion, Size: request.Size, Spin: request.Spin, Color: normalizeLyricColor(request.Color)}
		sprite.Label = truncateLyricSpriteLabel(strings.TrimSpace(request.Image))
		if icon := lyricSpriteIcons[request.Icon]; icon != nil {
			sprite.Icon = request.Icon
			for _, d := range icon {
				sprite.Paths = append(sprite.Paths, dto.MusicLyricSpritePath{D: d, Paint: "line"})
			}
		} else {
			if len(request.Paths) == 0 || len(request.Paths) > lyricSpriteMaxPaths {
				continue
			}
			valid := true
			for _, path := range request.Paths {
				if !lyricSpritePaints[path.Paint] || !validLyricSpritePath(path.D) {
					valid = false
					break
				}
				sprite.Paths = append(sprite.Paths, dto.MusicLyricSpritePath{D: strings.TrimSpace(path.D), Paint: path.Paint})
			}
			if !valid {
				continue
			}
		}
		if !lyricSpriteMotions[sprite.Motion] {
			sprite.Motion = "fall"
		}
		if !lyricSpriteSizes[sprite.Size] {
			sprite.Size = lyricSpriteDefaultSize
		}
		if sprite.Color == "" {
			sprite.Color = lyricSpriteDefaultColor
		}
		sprites = append(sprites, sprite)
	}
	return sprites, fallbacks
}

// lyricSpriteScene 行的场景：内置场景原样返回；custom:<name> 指向通过校验的粒子时原样返回，指向被丢弃的粒子时换成它的备用场景
func lyricSpriteScene(scene string, sprites []dto.MusicLyricSprite, fallbacks map[string]string) string {
	if lyricAnnotationScenes[scene] {
		return scene
	}
	name, custom := strings.CutPrefix(scene, "custom:")
	if !custom {
		return ""
	}
	for _, sprite := range sprites {
		if sprite.Name == name {
			return scene
		}
	}
	return fallbacks[name]
}

// lyricUsedSprites 只保留有行用到的粒子（没有时为 nil，不写入保存的数据）
func lyricUsedSprites(sprites []dto.MusicLyricSprite, lines []dto.MusicLyricAnnotationLine) []dto.MusicLyricSprite {
	var used []dto.MusicLyricSprite
	for _, sprite := range sprites {
		for _, line := range lines {
			if line.Scene == "custom:"+sprite.Name {
				used = append(used, sprite)
				break
			}
		}
	}
	return used
}

// drawLyricSprite 请模型画一个粒子图标：用户消息为意象与它所在的那行歌词，返回 {"paths": [...]} 中的 paths（未校验，交给 sanitizeLyricSprites）
func (a *lyricAnnotationService) drawLyricSprite(cfg tools.AIConfig, image, lyric string) (json.RawMessage, error) {
	user := lyricAnnotationText.SpriteSubject + image
	if lyric != "" {
		user += "\n" + lyricAnnotationText.SpriteLyric + lyric
	}
	raw, err := a.call(cfg, lyricAnnotationText.SpritePrompt, user)
	if err != nil {
		return nil, err
	}
	object, err := extractJSONObject(raw)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Paths json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal([]byte(object), &parsed); err != nil {
		return nil, err
	}
	return parsed.Paths, nil
}

// truncateLyricSpriteLabel 意象描述作为后台显示的名称，最多 lyricSpriteMaxLabel 个字
func truncateLyricSpriteLabel(label string) string {
	if utf8.RuneCountInString(label) <= lyricSpriteMaxLabel {
		return label
	}
	return string([]rune(label)[:lyricSpriteMaxLabel])
}
