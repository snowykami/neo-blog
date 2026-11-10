/**
 * 提前拉取播放器与歌词引擎的代码块。
 *
 * 播放器在首屏不挂载（空闲时才挂），歌词引擎在真正需要时才加载；用户把指针移到「播放」上时先把代码取回来，
 * 点下去就不用等 chunk 下载（移动端没有 hover，直接点播放也只在第一次多几十毫秒）。
 */
let warmed = false

export function prefetchMusicPlayer() {
  if (warmed)
    return
  warmed = true
  void import('@/components/common/music-player')
  void import('@/components/music-page/music-lyric-stage')
}
