/**
 * 首帧脚本（内联在 <head> 里，在水合之前执行）。
 *
 * 这里解决三件事，都必须在水合前完成，否则会闪：
 * 1. 明暗：按「节日默认 → 用户本次节日的手动选择 → 用户长期偏好 → 系统」定下 .dark；
 * 2. 用户关掉节日主题（theme-pack=off）时，先把 data-theme / data-theme-mode 摘掉；
 * 3. 清掉不属于当前节日的手动明暗标记（节日过后自动失效）。
 *
 * 逻辑与 themes/mode.ts 保持一致；因为要内联成字符串，不能直接复用那里的函数，
 * 所以单独放一个文件并配单测（init-script.test.ts）守住两边不漂移。
 */
export const themeInitScript = `(function(){try{var e=document.documentElement;if(localStorage.getItem('theme-pack')==='off'){e.removeAttribute('data-theme');e.removeAttribute('data-theme-effect');e.removeAttribute('data-theme-mode')}var id=e.getAttribute('data-theme');var bound=id?e.getAttribute('data-theme-mode'):null;var ov=null;try{ov=JSON.parse(localStorage.getItem('theme-mode-override')||'null')}catch(_){ov=null}if(ov&&(!id||ov.id!==id)){localStorage.removeItem('theme-mode-override');ov=null}var pref;if(bound){pref=(ov&&(ov.mode==='light'||ov.mode==='dark'||ov.mode==='system'))?ov.mode:bound}else{var t=localStorage.getItem('theme');pref=(t==='light'||t==='dark')?t:'system'}var d=pref==='dark'||(pref==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';var c=localStorage.getItem('color-scheme');if(c){e.setAttribute('data-user-color',c)}}catch(_){}})()`
