// 文章内多个自定义音频（音乐卡片、歌词摘录）共用：同一时间只播放一个
let activeAudio: HTMLAudioElement | null = null

/** 开始播放某个自定义音频：暂停其他正在播放的卡片 */
export function claimActiveAudio(audio: HTMLAudioElement) {
  if (activeAudio && activeAudio !== audio)
    activeAudio.pause()
  activeAudio = audio
}

/** 卡片暂停或卸载时释放占用 */
export function releaseActiveAudio(audio: HTMLAudioElement) {
  if (activeAudio === audio)
    activeAudio = null
}
