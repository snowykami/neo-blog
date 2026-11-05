package service

import (
	"cmp"
	"os"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/snowykami/neo-blog/internal/dto"
)

// 运行环境检测：本实例跑在 Kubernetes、Docker、虚拟机还是普通 Linux 上，显示在后台「系统运行」的实例信息里。
// 只用于展示，程序的任何行为都不能根据检测结果改变。规则与前端 web/src/lib/runtime-environment.ts 相同，按顺序命中即停

// 运行环境的取值，界面上的名称由前端翻译
const (
	EnvKindKubernetes = "kubernetes"
	EnvKindDocker     = "docker"
	EnvKindPodman     = "podman"
	EnvKindContainer  = "container" // 其他容器（cgroup 或根目录的文件系统看得出是容器）
	EnvKindWSL        = "wsl"
	EnvKindVM         = "vm"
	EnvKindLinux      = "linux" // 没检测到容器或虚拟机，不能据此认定是物理机
	EnvKindWindows    = "windows"
	EnvKindMacOS      = "macos"
)

const serviceAccountNamespaceFile = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"

// containerCgroupMarkers cgroup 路径中出现即说明在容器里
var containerCgroupMarkers = []string{"kubepods", "docker", "containerd", "crio", "libpod", "lxc"}

// vmVendorMarkers DMI 厂商或产品名中出现即说明在虚拟机里（不区分大小写）
var vmVendorMarkers = []string{
	"QEMU", "KVM", "VMware", "VirtualBox", "innotek", "Xen", "Bochs", "Parallels", "Microsoft Corporation",
	"Amazon EC2", "Google", "Alibaba Cloud", "Tencent Cloud", "OpenStack", "DigitalOcean", "Hetzner",
}

// envProbe 检测时读取系统信息的入口，测试中替换为假的文件与环境变量
type envProbe struct {
	goos     string
	goarch   string
	getenv   func(key string) string
	readFile func(path string) ([]byte, error) // 文件不存在或读不了时返回错误
}

func systemEnvProbe() envProbe {
	return envProbe{goos: runtime.GOOS, goarch: runtime.GOARCH, getenv: os.Getenv, readFile: os.ReadFile}
}

// currentEnvironment 本进程的运行环境，启动后第一次用到时检测，之后复用
var currentEnvironment = sync.OnceValue(func() dto.RuntimeEnvironmentDto {
	return detectEnvironment(systemEnvProbe())
})

// detectEnvironment 按顺序检测运行环境，并附带架构、内核、发行版与 Pod 信息；读不到的留空
func detectEnvironment(p envProbe) dto.RuntimeEnvironmentDto {
	env := dto.RuntimeEnvironmentDto{
		Arch:         p.goarch,
		Kernel:       p.text("/proc/sys/kernel/osrelease"),
		Distro:       osReleasePrettyName(p.text("/etc/os-release")),
		PodName:      strings.TrimSpace(p.getenv("POD_NAME")),
		PodNamespace: cmp.Or(strings.TrimSpace(p.getenv("POD_NAMESPACE")), p.text(serviceAccountNamespaceFile)),
		NodeName:     strings.TrimSpace(p.getenv("NODE_NAME")),
	}
	env.Kind, env.Evidence = p.kind()
	return env
}

// kind 运行环境及命中的依据；其他类 Unix 系统没有单独的取值，按 Linux 的规则检测
func (p envProbe) kind() (kind, evidence string) {
	switch p.goos {
	case "windows":
		return EnvKindWindows, "goos:windows"
	case "darwin":
		return EnvKindMacOS, "goos:darwin"
	}
	if p.getenv("KUBERNETES_SERVICE_HOST") != "" {
		return EnvKindKubernetes, "env:KUBERNETES_SERVICE_HOST"
	}
	if p.exists("/.dockerenv") {
		return EnvKindDocker, "file:/.dockerenv"
	}
	if p.exists("/run/.containerenv") {
		return EnvKindPodman, "file:/run/.containerenv"
	}
	for _, path := range []string{"/proc/1/cgroup", "/proc/self/cgroup"} {
		if marker := cgroupContainerMarker(p.text(path)); marker != "" {
			return EnvKindContainer, "cgroup:" + marker
		}
	}
	if rootFSType(p.text("/proc/self/mountinfo")) == "overlay" {
		return EnvKindContainer, "mountinfo:overlay"
	}
	if strings.Contains(strings.ToLower(p.text("/proc/version")), "microsoft") {
		return EnvKindWSL, "proc:version"
	}
	if p.getenv("WSL_DISTRO_NAME") != "" {
		return EnvKindWSL, "env:WSL_DISTRO_NAME"
	}
	for _, path := range []string{"/sys/class/dmi/id/sys_vendor", "/sys/class/dmi/id/product_name"} {
		if marker := containsFold(p.text(path), vmVendorMarkers); marker != "" {
			return EnvKindVM, "dmi:" + marker
		}
	}
	if cpuHasHypervisorFlag(p.text("/proc/cpuinfo")) {
		return EnvKindVM, "cpuinfo:hypervisor"
	}
	return EnvKindLinux, ""
}

func (p envProbe) exists(path string) bool {
	_, err := p.readFile(path)
	return err == nil
}

// text 文件内容去掉首尾空白，读不到时为空
func (p envProbe) text(path string) string {
	data, err := p.readFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// cgroupContainerMarker cgroup 文件每行为「层级:控制器:路径」，路径中出现容器标记时返回该标记。
// cgroup v2 的容器里通常只有「0::/」，此时看不出来，交给后面的规则
func cgroupContainerMarker(content string) string {
	for line := range strings.Lines(content) {
		parts := strings.SplitN(strings.TrimSpace(line), ":", 3)
		if len(parts) != 3 {
			continue
		}
		if marker := containsFold(parts[2], containerCgroupMarkers); marker != "" {
			return marker
		}
	}
	return ""
}

// rootFSType mountinfo 中挂载点为「/」的文件系统类型（取最后一条，后挂载的覆盖前面的）。
// 每行格式：ID 父ID 主:次 根 挂载点 选项 [可选字段...] - 类型 来源 超级块选项
func rootFSType(content string) string {
	fsType := ""
	for line := range strings.Lines(content) {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[4] != "/" {
			continue
		}
		if i := slices.Index(fields, "-"); i >= 0 && i+1 < len(fields) {
			fsType = fields[i+1]
		}
	}
	return fsType
}

// cpuHasHypervisorFlag /proc/cpuinfo 的 flags 行中有 hypervisor（虚拟机里 CPU 会带这个标志）
func cpuHasHypervisorFlag(content string) bool {
	for line := range strings.Lines(content) {
		key, value, ok := strings.Cut(line, ":")
		if ok && strings.TrimSpace(key) == "flags" && slices.Contains(strings.Fields(value), "hypervisor") {
			return true
		}
	}
	return false
}

// osReleasePrettyName /etc/os-release 中的 PRETTY_NAME，如 Alpine Linux v3.22
func osReleasePrettyName(content string) string {
	for line := range strings.Lines(content) {
		value, ok := strings.CutPrefix(strings.TrimSpace(line), "PRETTY_NAME=")
		if !ok {
			continue
		}
		if unquoted, err := strconv.Unquote(value); err == nil {
			return unquoted
		}
		return strings.Trim(value, `"'`)
	}
	return ""
}

// containsFold s 中出现（不区分大小写）的第一个标记，没有时为空
func containsFold(s string, markers []string) string {
	lower := strings.ToLower(s)
	for _, marker := range markers {
		if strings.Contains(lower, strings.ToLower(marker)) {
			return marker
		}
	}
	return ""
}
