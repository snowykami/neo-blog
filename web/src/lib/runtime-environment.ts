import { readFileSync } from 'node:fs'
import os from 'node:os'
import process from 'node:process'

// 运行环境检测：前端（Next.js 服务端）实例跑在 Kubernetes、Docker、虚拟机还是普通 Linux 上，显示在后台「系统运行」的实例信息里。
// 只用于展示，程序的任何行为都不能根据检测结果改变。只在 Node 服务端运行（由 server-metrics 引用），
// 规则与后端 internal/service/runtime_environment.go 相同，按顺序命中即停

export type RuntimeEnvironmentKind = 'kubernetes' | 'docker' | 'podman' | 'container' | 'wsl' | 'vm' | 'linux' | 'windows' | 'macos'

/** 字段与后端 dto.RuntimeEnvironmentDto 一致（snake_case），读不到的为空字符串 */
export interface RuntimeEnvironmentSnapshot {
  kind: RuntimeEnvironmentKind
  arch: string
  kernel: string // 容器里是宿主机的内核
  distro: string // /etc/os-release 的 PRETTY_NAME；容器里是镜像的发行版
  pod_name: string // Pod 名、命名空间、节点名由 Kubernetes Downward API 注入
  pod_namespace: string
  node_name: string
  evidence: string // 命中的依据，如 env:KUBERNETES_SERVICE_HOST、file:/.dockerenv
}

/** 检测时读取系统信息的入口，测试中替换为假的文件与环境变量 */
export interface EnvProbe {
  platform: string // process.platform
  arch: string
  kernel: string
  getenv: (key: string) => string | undefined
  readFile: (path: string) => string | null // 文件不存在或读不了时为 null
}

const SERVICE_ACCOUNT_NAMESPACE_FILE = '/var/run/secrets/kubernetes.io/serviceaccount/namespace'

// cgroup 路径中出现即说明在容器里
const CONTAINER_CGROUP_MARKERS = ['kubepods', 'docker', 'containerd', 'crio', 'libpod', 'lxc']

// DMI 厂商或产品名中出现即说明在虚拟机里（不区分大小写）
const VM_VENDOR_MARKERS = [
  'QEMU',
  'KVM',
  'VMware',
  'VirtualBox',
  'innotek',
  'Xen',
  'Bochs',
  'Parallels',
  'Microsoft Corporation',
  'Amazon EC2',
  'Google',
  'Alibaba Cloud',
  'Tencent Cloud',
  'OpenStack',
  'DigitalOcean',
  'Hetzner',
]

function systemProbe(): EnvProbe {
  return {
    platform: process.platform,
    arch: process.arch,
    kernel: os.release(),
    getenv: key => process.env[key],
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8')
      }
      catch {
        return null
      }
    },
  }
}

/** 按顺序检测运行环境，并附带架构、内核、发行版与 Pod 信息；读不到的留空 */
export function detectEnvironment(probe: EnvProbe): RuntimeEnvironmentSnapshot {
  const text = (path: string) => probe.readFile(path)?.trim() ?? ''
  const env = (key: string) => probe.getenv(key)?.trim() ?? ''
  const [kind, evidence] = detectKind(probe, text, env)
  return {
    kind,
    arch: probe.arch,
    kernel: probe.kernel.trim(),
    distro: osReleasePrettyName(text('/etc/os-release')),
    pod_name: env('POD_NAME'),
    pod_namespace: env('POD_NAMESPACE') || text(SERVICE_ACCOUNT_NAMESPACE_FILE),
    node_name: env('NODE_NAME'),
    evidence,
  }
}

// 其他类 Unix 系统没有单独的取值，按 Linux 的规则检测
function detectKind(probe: EnvProbe, text: (path: string) => string, env: (key: string) => string): [RuntimeEnvironmentKind, string] {
  if (probe.platform === 'win32')
    return ['windows', 'platform:win32']
  if (probe.platform === 'darwin')
    return ['macos', 'platform:darwin']
  if (env('KUBERNETES_SERVICE_HOST'))
    return ['kubernetes', 'env:KUBERNETES_SERVICE_HOST']
  if (probe.readFile('/.dockerenv') !== null)
    return ['docker', 'file:/.dockerenv']
  if (probe.readFile('/run/.containerenv') !== null)
    return ['podman', 'file:/run/.containerenv']
  for (const path of ['/proc/1/cgroup', '/proc/self/cgroup']) {
    const marker = cgroupContainerMarker(text(path))
    if (marker)
      return ['container', `cgroup:${marker}`]
  }
  if (rootFsType(text('/proc/self/mountinfo')) === 'overlay')
    return ['container', 'mountinfo:overlay']
  if (text('/proc/version').toLowerCase().includes('microsoft'))
    return ['wsl', 'proc:version']
  if (env('WSL_DISTRO_NAME'))
    return ['wsl', 'env:WSL_DISTRO_NAME']
  for (const path of ['/sys/class/dmi/id/sys_vendor', '/sys/class/dmi/id/product_name']) {
    const marker = findMarker(text(path), VM_VENDOR_MARKERS)
    if (marker)
      return ['vm', `dmi:${marker}`]
  }
  if (cpuHasHypervisorFlag(text('/proc/cpuinfo')))
    return ['vm', 'cpuinfo:hypervisor']
  return ['linux', '']
}

// cgroup 文件每行为「层级:控制器:路径」，路径中出现容器标记时返回该标记；
// cgroup v2 的容器里通常只有「0::/」，此时看不出来，交给后面的规则
function cgroupContainerMarker(content: string): string {
  for (const line of content.split('\n')) {
    const parts = line.trim().split(':')
    if (parts.length < 3)
      continue
    const marker = findMarker(parts.slice(2).join(':'), CONTAINER_CGROUP_MARKERS)
    if (marker)
      return marker
  }
  return ''
}

// mountinfo 中挂载点为「/」的文件系统类型（取最后一条，后挂载的覆盖前面的）。
// 每行格式：ID 父ID 主:次 根 挂载点 选项 [可选字段...] - 类型 来源 超级块选项
function rootFsType(content: string): string {
  let fsType = ''
  for (const line of content.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 5 || fields[4] !== '/')
      continue
    const separator = fields.indexOf('-')
    if (separator >= 0 && separator + 1 < fields.length)
      fsType = fields[separator + 1]
  }
  return fsType
}

// /proc/cpuinfo 的 flags 行中有 hypervisor（虚拟机里 CPU 会带这个标志）
function cpuHasHypervisorFlag(content: string): boolean {
  return content.split('\n').some((line) => {
    const index = line.indexOf(':')
    return index >= 0 && line.slice(0, index).trim() === 'flags' && line.slice(index + 1).trim().split(/\s+/).includes('hypervisor')
  })
}

// /etc/os-release 中的 PRETTY_NAME，如 Alpine Linux v3.22
export function osReleasePrettyName(content: string): string {
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('PRETTY_NAME='))
      return trimmed.slice('PRETTY_NAME='.length).replace(/^(["'])(.*)\1$/, '$2')
  }
  return ''
}

// s 中出现（不区分大小写）的第一个标记，没有时为空
function findMarker(s: string, markers: string[]): string {
  const lower = s.toLowerCase()
  return markers.find(marker => lower.includes(marker.toLowerCase())) ?? ''
}

// 放在 globalThis 上：instrumentation 与路由处理函数分别打包，但运行在同一个进程里，只检测一次
const ENVIRONMENT_KEY = Symbol.for('neo-blog.runtime-environment')

/** 本进程的运行环境，第一次用到时检测，之后复用 */
export function currentEnvironment(): RuntimeEnvironmentSnapshot {
  const holder = globalThis as unknown as Record<symbol, RuntimeEnvironmentSnapshot | undefined>
  holder[ENVIRONMENT_KEY] ??= detectEnvironment(systemProbe())
  return holder[ENVIRONMENT_KEY]
}
