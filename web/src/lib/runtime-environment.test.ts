// @vitest-environment node
import type { EnvProbe, RuntimeEnvironmentKind } from './runtime-environment'
import { describe, expect, it } from 'vitest'
import { currentEnvironment, detectEnvironment, osReleasePrettyName } from './runtime-environment'

// 用内存中的文件与环境变量模拟一台 Linux 机器，用例与后端 runtime_environment_test.go 相同
function fakeProbe(platform: string, files: Record<string, string> = {}, env: Record<string, string> = {}, kernel = ''): EnvProbe {
  return {
    platform,
    arch: 'x64',
    kernel,
    getenv: key => env[key],
    readFile: path => (path in files ? files[path] : null),
  }
}

const CGROUP_V2_ROOT = '0::/\n'
const MOUNTINFO_EXT4 = '22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw\n'
const MOUNTINFO_OVERLAY = '640 560 0:52 / / rw,relatime master:1 - overlay overlay rw,lowerdir=/a,upperdir=/b,workdir=/c\n'

describe('runtime environment', () => {
  const cases: { name: string, platform: string, files?: Record<string, string>, env?: Record<string, string>, kind: RuntimeEnvironmentKind, evidence: string }[] = [
    { name: 'windows', platform: 'win32', kind: 'windows', evidence: 'platform:win32' },
    { name: 'macos', platform: 'darwin', kind: 'macos', evidence: 'platform:darwin' },
    { name: 'kubernetes', platform: 'linux', env: { KUBERNETES_SERVICE_HOST: '10.43.0.1' }, files: { '/proc/1/cgroup': CGROUP_V2_ROOT }, kind: 'kubernetes', evidence: 'env:KUBERNETES_SERVICE_HOST' },
    // Kubernetes 优先于 Docker：用 Docker 作运行时的集群里两者都有
    { name: 'kubernetes over docker', platform: 'linux', env: { KUBERNETES_SERVICE_HOST: '10.43.0.1' }, files: { '/.dockerenv': '' }, kind: 'kubernetes', evidence: 'env:KUBERNETES_SERVICE_HOST' },
    { name: 'docker', platform: 'linux', files: { '/.dockerenv': '', '/proc/1/cgroup': CGROUP_V2_ROOT }, kind: 'docker', evidence: 'file:/.dockerenv' },
    { name: 'podman', platform: 'linux', files: { '/run/.containerenv': 'engine="podman-5.0"\n' }, kind: 'podman', evidence: 'file:/run/.containerenv' },
    { name: 'cgroup v1 kubepods', platform: 'linux', files: { '/proc/1/cgroup': '12:memory:/kubepods/burstable/pod1234/abcd\n' }, kind: 'container', evidence: 'cgroup:kubepods' },
    { name: 'cgroup v2 containerd in self', platform: 'linux', files: { '/proc/1/cgroup': CGROUP_V2_ROOT, '/proc/self/cgroup': '0::/system.slice/containerd-abc.scope\n' }, kind: 'container', evidence: 'cgroup:containerd' },
    { name: 'cgroup lxc', platform: 'linux', files: { '/proc/1/cgroup': '0::/lxc.payload.web/init.scope\n' }, kind: 'container', evidence: 'cgroup:lxc' },
    { name: 'overlay root', platform: 'linux', files: { '/proc/1/cgroup': CGROUP_V2_ROOT, '/proc/self/mountinfo': MOUNTINFO_OVERLAY }, kind: 'container', evidence: 'mountinfo:overlay' },
    { name: 'wsl by proc version', platform: 'linux', files: { '/proc/version': 'Linux version 5.15.153.1-microsoft-standard-WSL2', '/proc/self/mountinfo': MOUNTINFO_EXT4 }, kind: 'wsl', evidence: 'proc:version' },
    { name: 'wsl by env', platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, kind: 'wsl', evidence: 'env:WSL_DISTRO_NAME' },
    { name: 'vm by vendor', platform: 'linux', files: { '/sys/class/dmi/id/sys_vendor': 'QEMU\n' }, kind: 'vm', evidence: 'dmi:QEMU' },
    { name: 'vm by product', platform: 'linux', files: { '/sys/class/dmi/id/sys_vendor': 'Dell Inc.', '/sys/class/dmi/id/product_name': 'VMware Virtual Platform' }, kind: 'vm', evidence: 'dmi:VMware' },
    { name: 'vm by cpuinfo', platform: 'linux', files: { '/proc/cpuinfo': 'processor\t: 0\nflags\t\t: fpu vme de pse tsc msr hypervisor lahf_lm\n' }, kind: 'vm', evidence: 'cpuinfo:hypervisor' },
    // cgroup v2 下只有「0::/」、根目录是 ext4、CPU 没有 hypervisor：看不出是容器，不能误判
    {
      name: 'cgroup v2 root only',
      platform: 'linux',
      files: { '/proc/1/cgroup': CGROUP_V2_ROOT, '/proc/self/cgroup': CGROUP_V2_ROOT, '/proc/self/mountinfo': MOUNTINFO_EXT4, '/proc/cpuinfo': 'flags\t\t: fpu vme sse sse2\n', '/sys/class/dmi/id/sys_vendor': 'Dell Inc.' },
      kind: 'linux',
      evidence: '',
    },
    { name: 'nothing', platform: 'linux', kind: 'linux', evidence: '' },
    // 其他类 Unix 系统按 Linux 的规则检测
    { name: 'freebsd', platform: 'freebsd', kind: 'linux', evidence: '' },
  ]

  it.each(cases)('detects $name', ({ platform, files, env, kind, evidence }) => {
    const result = detectEnvironment(fakeProbe(platform, files, env))
    expect([result.kind, result.evidence]).toEqual([kind, evidence])
  })

  it('collects details and reads the namespace from the service account file', () => {
    const files = {
      '/etc/os-release': 'NAME="Alpine Linux"\nID=alpine\nPRETTY_NAME="Alpine Linux v3.22"\n',
      '/var/run/secrets/kubernetes.io/serviceaccount/namespace': 'luna-snowykami-blog\n',
    }
    const env = { KUBERNETES_SERVICE_HOST: '10.43.0.1', POD_NAME: 'blog-frontend-54967b4f86-lqgxd', NODE_NAME: 'kami-master' }
    expect(detectEnvironment(fakeProbe('linux', files, env, '6.8.0-45-generic\n'))).toEqual({
      kind: 'kubernetes',
      arch: 'x64',
      kernel: '6.8.0-45-generic',
      distro: 'Alpine Linux v3.22',
      pod_name: 'blog-frontend-54967b4f86-lqgxd',
      pod_namespace: 'luna-snowykami-blog',
      node_name: 'kami-master',
      evidence: 'env:KUBERNETES_SERVICE_HOST',
    })
    // Downward API 注入的命名空间优先
    expect(detectEnvironment(fakeProbe('linux', files, { ...env, POD_NAMESPACE: 'from-downward-api' })).pod_namespace).toBe('from-downward-api')
    // 读不到的留空
    expect(detectEnvironment(fakeProbe('darwin'))).toMatchObject({ kernel: '', distro: '', pod_name: '', pod_namespace: '', node_name: '' })
  })

  it('parses PRETTY_NAME', () => {
    expect(osReleasePrettyName('PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n')).toBe('Debian GNU/Linux 12 (bookworm)')
    expect(osReleasePrettyName('ID=arch\nPRETTY_NAME=\'Arch Linux\'\n')).toBe('Arch Linux')
    expect(osReleasePrettyName('PRETTY_NAME=Ubuntu\n')).toBe('Ubuntu')
    expect(osReleasePrettyName('NAME=Alpine\n')).toBe('')
  })

  it('detects the current process once', () => {
    const env = currentEnvironment()
    expect(env.kind).toBeTruthy()
    expect(env.arch).toBe(process.arch)
    expect(currentEnvironment()).toBe(env)
  })
})
