import type { RhythmContext } from '@/lib/lyrics/rhythm/effects'
import { interludeOctave, periodOf } from '@/lib/lyrics/rhythm/effects'

/**
 * 调试面板的公式（LaTeX，交给 KaTeX 渲染）：simple 为一行概括；full 按「周期、输入、输出、系统、映射」分段，代入当前的 T_b、T_e 与参数。
 * 公式本身不含自然语言，各段的标题由调用方按语言显示
 */

export type DebugEffect = 'heartbeat' | 'swell' | 'glow' | 'wave' | 'shake' | 'shimmer' | 'background' | 'interlude'

export type FormulaSection = 'period' | 'input' | 'output' | 'system' | 'mapping'

export interface FormulaSet {
  simple: string
  full: { section: FormulaSection, tex: string }[]
}

/** 毫秒 → 秒，最多三位小数 */
function s(ms: number) {
  return `${Number((ms / 1000).toFixed(3))}\\,\\mathrm{s}`
}

function ms(value: number) {
  return `${Number(value.toFixed(1))}\\,\\mathrm{ms}`
}

function num(value: number, digits = 2) {
  return String(Number(value.toFixed(digits)))
}

export function octaveOf(effect: DebugEffect, ctx: RhythmContext) {
  const p = ctx.params
  switch (effect) {
    case 'heartbeat': return p.heartbeat.octave
    case 'swell': return p.swell.octave
    case 'glow': return p.glow.octave
    case 'wave': return p.wave.octave
    case 'shake': return p.shake.octave
    case 'shimmer': return p.shimmer.octave
    case 'background': return p.background.octave
    case 'interlude': return interludeOctave(ctx)
  }
}

export function formulasFor(effect: DebugEffect, ctx: RhythmContext): FormulaSet {
  const p = ctx.params
  const n = octaveOf(effect, ctx)
  const Te = periodOf(ctx, n)
  const beat = ctx.pace === 'beat'

  const period = beat
    ? `T_b=\\tau_F=\\mathop{\\arg\\max}_{\\tau\\in[0.5,\\,1)\\,\\mathrm{s}}\\Big[R\\big(\\tfrac{\\tau}{2}\\big)+R(\\tau)+\\tfrac12R(2\\tau)\\Big]=${s(ctx.base)},\\qquad T_e=2^{n_e}T_b=2^{${n}}\\times${s(ctx.base)}=${s(Te)}`
    : `T_b=${s(ctx.base)}\\;(\\mathrm{${ctx.pace}}),\\qquad T_e=2^{n_e}T_b=2^{${n}}\\times${s(ctx.base)}=${s(Te)}`
  const input = beat
    ? `x_e(t)=\\sum_k a_k\\,\\delta(t-t_k),\\quad t_k\\in\\mathcal{R}_{k_b+n_e}\\{t_i\\},\\quad a_k=a_{\\min}+(1-a_{\\min})\\operatorname{clamp}\\!\\Big(\\frac{L(t_k)-L_{10}}{L_{95}-L_{10}}\\Big),\\ a_{\\min}=${num(p.accentMin)}`
    : `x_e(t)=\\sum_k \\delta(t-t_k),\\quad t_k=s+kT_e`
  const output = `y_e(t)=\\sum_{t_k\\in W_e}a_k\\,h_e\\big(t+t_{\\mathrm{lead}}-t_k\\big),\\quad t_{\\mathrm{lead}}=${ms(p.leadMs)}`
  const alpha = `g_\\tau(t)=\\frac{t}{\\tau}\\,e^{1-t/\\tau}\\,u(t)`

  switch (effect) {
    case 'heartbeat': {
      const h = p.heartbeat
      const delta = Math.min(h.delayMaxMs, Math.max(h.delayMinMs, h.delayRatio * Te))
      return {
        simple: `y(t)=\\sum_k a_k\\big[g_{\\tau_a}(t-t_k)+\\beta\\,g_{\\tau_a}(t-t_k-\\Delta)\\big]`,
        full: [
          { section: 'period', tex: period },
          { section: 'input', tex: input },
          { section: 'output', tex: `${output},\\quad W_e=[s-60\\,\\mathrm{ms},\\,e]` },
          { section: 'system', tex: `h(t)=g_{\\tau_a}(t)+\\beta\\,g_{\\tau_a}(t-\\Delta),\\quad ${alpha},\\quad \\tau_a=${ms(h.attackMs)},\\ \\beta=${num(h.beta)},\\ \\Delta=\\operatorname{clamp}(${num(h.delayRatio)}T_e,\\,${s(h.delayMinMs)},\\,${s(h.delayMaxMs)})=${s(delta)}` },
          { section: 'mapping', tex: `\\mathrm{scale}_i=1+0.04fv_i+0.16fy,\\quad x_i=\\Big(i-\\frac{m-1}{2}\\Big)0.06fy,\\quad \\mathrm{glow}_i=v_i(0.2+0.2f)+(0.3+0.35f)\\,y` },
        ],
      }
    }
    case 'swell': {
      const w = p.swell
      return {
        simple: `k_i(t)=v_i(t)\\big(1+\\gamma\\,y(t)\\big),\\quad y(t)=\\sum_k a_k\\,g_\\tau(t-t_k)`,
        full: [
          { section: 'period', tex: period },
          { section: 'input', tex: input },
          { section: 'output', tex: output },
          { section: 'system', tex: `h(t)=g_\\tau(t),\\quad ${alpha},\\quad \\tau=${ms(w.tauMs)},\\ \\gamma=${num(w.gain)};\\quad v_i(t)=\\operatorname{swell}\\!\\Big(\\frac{t-s-0.4Di/m}{D}\\Big),\\ D=\\max(1\\,\\mathrm{s},\\,e-s)\\cdot\\frac{T_b}{0.75\\,\\mathrm{s}}` },
          { section: 'mapping', tex: `\\mathrm{scale}_i=1+0.14fk_i,\\quad x_i=-0.03fk_i\\Big(\\frac m2-i-\\frac12\\Big),\\quad \\Delta y_i=-0.025fk_i,\\quad \\mathrm{glow}_i=v_i(0.25+0.45f)(1+0.4y)` },
        ],
      }
    }
    case 'glow':
      return {
        simple: `\\mathrm{glow}(t)=G(t)\\big(0.3+0.7\\,y(t)\\big),\\quad h(t)=\\cos^2\\frac{\\pi t}{T_e},\\ |t|<\\frac{T_e}{2}`,
        full: [
          { section: 'period', tex: period },
          { section: 'input', tex: input },
          { section: 'output', tex: `${output},\\quad W_e=[s-60\\,\\mathrm{ms},\\,e_{\\mathrm{line}}]` },
          { section: 'system', tex: `h(t)=\\cos^2\\!\\Big(\\frac{\\pi t}{T_e}\\Big)\\,\\mathbb{1}\\big[|t|<\\tfrac{T_e}{2}\\big],\\quad G(t)=\\operatorname{clamp}\\!\\Big(\\frac{t-s+0.15}{0.3}\\Big)\\operatorname{clamp}\\!\\Big(1-\\frac{t-e_{\\mathrm{line}}}{0.4}\\Big)` },
          { section: 'mapping', tex: `\\mathrm{glow}=G\\,(0.35+0.5f)(0.3+0.7y),\\quad \\mathrm{scale}=1+0.04f\\,G\\,y` },
        ],
      }
    case 'wave': {
      const width = p.wave.widthRatio * Te
      return {
        simple: `y_i(t)=\\sum_k a_k\\sin\\frac{\\pi\\,(t-t_k-i\\delta)}{w},\\quad 0\\le t-t_k-i\\delta<w`,
        full: [
          { section: 'period', tex: period },
          { section: 'input', tex: input },
          { section: 'output', tex: `y_i(t)=\\sum_{t_k\\in W_e}a_k\\,h\\big(t+t_{\\mathrm{lead}}-t_k-i\\delta\\big),\\quad W_e=[s-60\\,\\mathrm{ms},\\,e]` },
          { section: 'system', tex: `h(t)=\\sin\\frac{\\pi t}{w}\\,\\mathbb{1}[0\\le t<w],\\quad w=${num(p.wave.widthRatio)}T_e=${s(width)},\\quad \\delta=\\frac{0.5T_e}{m-1}` },
          { section: 'mapping', tex: `\\Delta y_i=-(0.08+0.14f)\\,y_i,\\quad \\mathrm{scale}_i=1+0.05f\\,y_i` },
        ],
      }
    }
    case 'shake': {
      const k = p.shake
      return {
        simple: `A_i(t)=v_i(t)\\big(0.35+0.65\\,y(t)\\big),\\quad h(t)=e^{-t/\\tau_s}u(t)`,
        full: [
          { section: 'period', tex: period },
          { section: 'input', tex: input },
          { section: 'output', tex: `${output},\\quad W_e=[s-60\\,\\mathrm{ms},\\,s+D]` },
          { section: 'system', tex: `h(t)=e^{-t/\\tau_s}u(t),\\ \\tau_s=${ms(k.decayMs)};\\quad \\varphi_i=\\frac{t-s_i}{T_b/d},\\ d=${num(k.carrierDivisor, 0)}\\ (T_b/d=${ms(ctx.base / k.carrierDivisor)})` },
          { section: 'mapping', tex: `x_i=0.035fA_i\\sin(2.3\\varphi_i+1.7i),\\quad \\Delta y_i=0.025fA_i\\cos(1.9\\varphi_i+1.3i),\\quad \\mathrm{scale}_i=1+0.06fA_i` },
        ],
      }
    }
    case 'shimmer':
      return {
        simple: `c(t)=\\operatorname{frac}\\big(\\varphi(t)\\big)\\,(m+2)-1,\\quad \\varphi(t)=k+\\frac{t-t_k}{t_{k+1}-t_k}`,
        full: [
          { section: 'period', tex: period },
          { section: 'input', tex: input },
          { section: 'output', tex: `\\varphi(t)=k+\\frac{t+t_{\\mathrm{lead}}-t_k}{t_{k+1}-t_k},\\quad t_k\\le t+t_{\\mathrm{lead}}<t_{k+1},\\quad k<${num(p.shimmer.sweeps, 0)}` },
          { section: 'system', tex: `c(t)=\\operatorname{frac}\\big(\\varphi(t)\\big)\\,(m+2)-1` },
          { section: 'mapping', tex: `\\mathrm{band}(x)=\\max\\big(0,\\,1-|x-c(t)|/0.4\\big)` },
        ],
      }
    case 'background': {
      const b = p.background
      return {
        simple: `y(t)=\\sum_k a_k\\,h(t-t_k),\\quad h(t)=\\min\\!\\Big(1,\\frac{t}{\\tau_a}\\Big)e^{-t/\\tau_d}u(t)`,
        full: [
          { section: 'period', tex: period },
          { section: 'input', tex: input },
          { section: 'output', tex: output },
          { section: 'system', tex: `h(t)=\\min\\!\\Big(1,\\frac{t}{\\tau_a}\\Big)e^{-t/\\tau_d}u(t),\\quad \\tau_a=${ms(b.attackMs)},\\ \\tau_d=${ms(b.decayMs)}` },
          { section: 'mapping', tex: `\\mathrm{opacity}=0.12\\,\\min(1,\\,y)` },
        ],
      }
    }
    case 'interlude': {
      const i = p.interlude
      return {
        simple: `s(t)=s_{k-1}+(s_k-s_{k-1})\\,E\\Big(\\frac{t-t_k}{0.8T_e}\\Big),\\quad s_k\\in\\{${num(i.inhale)},\\,${num(i.exhale)}\\}`,
        full: [
          { section: 'period', tex: `${period},\\quad n_e=\\operatorname{round}\\log_2\\frac{${s(i.targetMs)}}{T_b}` },
          { section: 'input', tex: `x(t)=\\sum_k(-1)^k\\delta(t-t_k)` },
          { section: 'output', tex: `s(t)=s_{k-1}+(s_k-s_{k-1})\\,E\\Big(\\frac{t-t_k}{0.8T_e}\\Big)` },
          { section: 'system', tex: `E=\\operatorname{cubicBezier}(0,0,0.58,1),\\quad s_k=\\begin{cases}${num(i.inhale)} & k\\equiv1\\ (\\mathrm{mod}\\ 2)\\\\ ${num(i.exhale)} & k\\equiv0\\ (\\mathrm{mod}\\ 2)\\end{cases}` },
          { section: 'mapping', tex: `\\mathrm{scale}=s(t)` },
        ],
      }
    }
  }
}
