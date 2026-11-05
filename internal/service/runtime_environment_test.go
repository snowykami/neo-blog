package service

import (
	"io/fs"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
)

// fakeProbe 用内存中的文件与环境变量模拟一台 Linux 机器
func fakeProbe(goos string, files map[string]string, env map[string]string) envProbe {
	return envProbe{
		goos:   goos,
		goarch: "amd64",
		getenv: func(key string) string { return env[key] },
		readFile: func(path string) ([]byte, error) {
			if content, ok := files[path]; ok {
				return []byte(content), nil
			}
			return nil, fs.ErrNotExist
		},
	}
}

const (
	cgroupV2Root   = "0::/\n"
	mountinfoExt4  = "22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw\n"
	mountinfoOverl = "640 560 0:52 / / rw,relatime master:1 - overlay overlay rw,lowerdir=/a,upperdir=/b,workdir=/c\n"
)

func TestDetectEnvironmentKind(t *testing.T) {
	cases := []struct {
		name         string
		goos         string
		files        map[string]string
		env          map[string]string
		wantKind     string
		wantEvidence string
	}{
		{name: "windows", goos: "windows", wantKind: EnvKindWindows, wantEvidence: "goos:windows"},
		{name: "macos", goos: "darwin", wantKind: EnvKindMacOS, wantEvidence: "goos:darwin"},
		{
			name:         "kubernetes",
			goos:         "linux",
			env:          map[string]string{"KUBERNETES_SERVICE_HOST": "10.43.0.1"},
			files:        map[string]string{"/proc/1/cgroup": cgroupV2Root},
			wantKind:     EnvKindKubernetes,
			wantEvidence: "env:KUBERNETES_SERVICE_HOST",
		},
		{
			// Kubernetes 优先于 Docker：用 Docker 作运行时的集群里两者都有
			name:         "kubernetes over docker",
			goos:         "linux",
			env:          map[string]string{"KUBERNETES_SERVICE_HOST": "10.43.0.1"},
			files:        map[string]string{"/.dockerenv": ""},
			wantKind:     EnvKindKubernetes,
			wantEvidence: "env:KUBERNETES_SERVICE_HOST",
		},
		{name: "docker", goos: "linux", files: map[string]string{"/.dockerenv": "", "/proc/1/cgroup": cgroupV2Root}, wantKind: EnvKindDocker, wantEvidence: "file:/.dockerenv"},
		{name: "podman", goos: "linux", files: map[string]string{"/run/.containerenv": "engine=\"podman-5.0\"\n"}, wantKind: EnvKindPodman, wantEvidence: "file:/run/.containerenv"},
		{
			name:         "cgroup v1 kubepods",
			goos:         "linux",
			files:        map[string]string{"/proc/1/cgroup": "12:memory:/kubepods/burstable/pod1234/abcd\n11:cpu:/kubepods/burstable/pod1234/abcd\n"},
			wantKind:     EnvKindContainer,
			wantEvidence: "cgroup:kubepods",
		},
		{
			name:         "cgroup v2 containerd in self",
			goos:         "linux",
			files:        map[string]string{"/proc/1/cgroup": cgroupV2Root, "/proc/self/cgroup": "0::/system.slice/containerd-abc.scope\n"},
			wantKind:     EnvKindContainer,
			wantEvidence: "cgroup:containerd",
		},
		{
			name:         "cgroup lxc",
			goos:         "linux",
			files:        map[string]string{"/proc/1/cgroup": "0::/lxc.payload.web/init.scope\n"},
			wantKind:     EnvKindContainer,
			wantEvidence: "cgroup:lxc",
		},
		{
			name:         "overlay root",
			goos:         "linux",
			files:        map[string]string{"/proc/1/cgroup": cgroupV2Root, "/proc/self/mountinfo": mountinfoOverl},
			wantKind:     EnvKindContainer,
			wantEvidence: "mountinfo:overlay",
		},
		{
			name:         "wsl by proc version",
			goos:         "linux",
			files:        map[string]string{"/proc/version": "Linux version 5.15.153.1-microsoft-standard-WSL2 (root@1c602f52c2e4)", "/proc/self/mountinfo": mountinfoExt4},
			wantKind:     EnvKindWSL,
			wantEvidence: "proc:version",
		},
		{name: "wsl by env", goos: "linux", env: map[string]string{"WSL_DISTRO_NAME": "Ubuntu"}, wantKind: EnvKindWSL, wantEvidence: "env:WSL_DISTRO_NAME"},
		{name: "vm by vendor", goos: "linux", files: map[string]string{"/sys/class/dmi/id/sys_vendor": "QEMU\n"}, wantKind: EnvKindVM, wantEvidence: "dmi:QEMU"},
		{name: "vm by product", goos: "linux", files: map[string]string{"/sys/class/dmi/id/sys_vendor": "Dell Inc.", "/sys/class/dmi/id/product_name": "VMware Virtual Platform"}, wantKind: EnvKindVM, wantEvidence: "dmi:VMware"},
		{
			name:         "vm by cpuinfo",
			goos:         "linux",
			files:        map[string]string{"/proc/cpuinfo": "processor\t: 0\nflags\t\t: fpu vme de pse tsc msr hypervisor lahf_lm\n"},
			wantKind:     EnvKindVM,
			wantEvidence: "cpuinfo:hypervisor",
		},
		{
			// cgroup v2 下只有「0::/」、根目录是 ext4、CPU 没有 hypervisor：看不出是容器，不能误判
			name:     "cgroup v2 root only",
			goos:     "linux",
			files:    map[string]string{"/proc/1/cgroup": cgroupV2Root, "/proc/self/cgroup": cgroupV2Root, "/proc/self/mountinfo": mountinfoExt4, "/proc/cpuinfo": "flags\t\t: fpu vme sse sse2\n", "/sys/class/dmi/id/sys_vendor": "Dell Inc."},
			wantKind: EnvKindLinux,
		},
		{name: "nothing", goos: "linux", wantKind: EnvKindLinux},
		// 其他类 Unix 系统按 Linux 的规则检测
		{name: "freebsd", goos: "freebsd", wantKind: EnvKindLinux},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := detectEnvironment(fakeProbe(tc.goos, tc.files, tc.env))
			if got.Kind != tc.wantKind || got.Evidence != tc.wantEvidence {
				t.Errorf("kind, evidence = %q, %q; want %q, %q", got.Kind, got.Evidence, tc.wantKind, tc.wantEvidence)
			}
		})
	}
}

// 附带信息：读不到的留空，命名空间优先用环境变量，没有时读 ServiceAccount 文件
func TestDetectEnvironmentDetails(t *testing.T) {
	files := map[string]string{
		"/proc/sys/kernel/osrelease": "6.8.0-45-generic\n",
		"/etc/os-release":            "NAME=\"Alpine Linux\"\nID=alpine\nPRETTY_NAME=\"Alpine Linux v3.22\"\n",
		serviceAccountNamespaceFile:  "luna-snowykami-blog\n",
	}
	env := map[string]string{"KUBERNETES_SERVICE_HOST": "10.43.0.1", "POD_NAME": "blog-backend-5dbf7c46b5-gvg48", "NODE_NAME": "kami-master"}
	got := detectEnvironment(fakeProbe("linux", files, env))
	want := dto.RuntimeEnvironmentDto{
		Kind: EnvKindKubernetes, Arch: "amd64", Kernel: "6.8.0-45-generic", Distro: "Alpine Linux v3.22",
		PodName: "blog-backend-5dbf7c46b5-gvg48", PodNamespace: "luna-snowykami-blog", NodeName: "kami-master",
		Evidence: "env:KUBERNETES_SERVICE_HOST",
	}
	if got != want {
		t.Errorf("detectEnvironment() = %+v\nwant %+v", got, want)
	}

	env["POD_NAMESPACE"] = "from-downward-api"
	if got := detectEnvironment(fakeProbe("linux", files, env)); got.PodNamespace != "from-downward-api" {
		t.Errorf("PodNamespace = %q, want env value first", got.PodNamespace)
	}

	empty := detectEnvironment(fakeProbe("darwin", nil, nil))
	if empty.Kernel != "" || empty.Distro != "" || empty.PodName != "" || empty.PodNamespace != "" || empty.NodeName != "" {
		t.Errorf("unreadable fields should be empty, got %+v", empty)
	}
}

func TestOSReleasePrettyName(t *testing.T) {
	cases := map[string]string{
		"PRETTY_NAME=\"Debian GNU/Linux 12 (bookworm)\"\n": "Debian GNU/Linux 12 (bookworm)",
		"ID=arch\nPRETTY_NAME='Arch Linux'\n":              "Arch Linux",
		"PRETTY_NAME=Ubuntu\n":                             "Ubuntu",
		"NAME=Alpine\n":                                    "",
	}
	for content, want := range cases {
		if got := osReleasePrettyName(content); got != want {
			t.Errorf("osReleasePrettyName(%q) = %q, want %q", content, got, want)
		}
	}
}

// 本机实际检测一次，确认读真实系统时不会出错
func TestCurrentEnvironment(t *testing.T) {
	env := currentEnvironment()
	if env.Kind == "" || env.Arch == "" {
		t.Errorf("currentEnvironment() = %+v, want kind and arch", env)
	}
	if snapshot := runtimeSnapshot(); snapshot.Environment == nil || snapshot.Environment.Kind != env.Kind {
		t.Errorf("runtimeSnapshot().Environment = %+v, want %q", snapshot.Environment, env.Kind)
	}
}
