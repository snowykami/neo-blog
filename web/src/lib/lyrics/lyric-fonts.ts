/**
 * 歌词字体的自托管网页字体（见 spec 7.2b「字体」）：只在系统没有对应字体时作为回退（字体栈见 lyric-player.css），
 * 手机（iOS / Android 不带宋体、楷体等中文字体）与没有下载可选字体的电脑上才会用到。
 * 体积控制：每种字体只引入一个字重（加粗由浏览器合成）、只用 woff2，按 unicode-range 分片——
 * 只声明 @font-face，浏览器只下载歌词里实际出现的字所在的分片，用不到的字体不会下载
 */
import '@fontsource/noto-serif-sc/700.css'
import 'lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css'
import '@fontsource/zhi-mang-xing/400.css'
import '@fontsource/zcool-xiaowei/400.css'
import '@fontsource/zcool-kuaile/400.css'
import '@fontsource/dancing-script/400.css'
