package main

import (
    "bufio"
    "bytes"
    "crypto/sha1"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "net"
    "net/http"
    "os"
    "runtime"
    "strconv"
    "strings"
    "syscall"
    "time"
)

type Payload struct {
    ServerID     string            `json:"server_id"`
    Hostname     string            `json:"hostname"`
    DisplayName  string            `json:"display_name"`
    IP           string            `json:"ip"`
    OS           string            `json:"os"`
    Arch         string            `json:"arch"`
    InstanceID   string            `json:"instance_id"`
    CPUUsage     float64           `json:"cpu_usage"`
    CPUCount     int               `json:"cpu_count"`
    MemoryUsage  float64           `json:"memory_usage"`
    MemoryUsed   uint64            `json:"memory_used"`
    MemoryTotal  uint64            `json:"memory_total"`
    DiskUsage    float64           `json:"disk_usage"`
    DiskUsed     uint64            `json:"disk_used"`
    DiskTotal    uint64            `json:"disk_total"`
    Ports        map[string]bool   `json:"ports"`
    Metadata     map[string]string `json:"metadata"`
}

func main() {
    apiBase := getEnv("MONITOR_API", "http://127.0.0.1:8080")
    intervalSec := getEnvInt("REPORT_INTERVAL", 10)
    displayName := getEnv("DISPLAY_NAME", "")

    for {
        payload, err := collect(displayName, intervalSec)
        if err != nil {
            fmt.Println("collect error:", err)
        } else {
            if err := report(apiBase+"/api/agent/register", payload); err != nil {
                fmt.Println("report error:", err)
            } else {
                fmt.Println("reported:", payload.ServerID, time.Now().Format(time.RFC3339))
            }
        }
        time.Sleep(time.Duration(intervalSec) * time.Second)
    }
}

func collect(displayName string, intervalSec int) (*Payload, error) {
    hostname, _ := os.Hostname()
    ip := publicIP()
    if strings.TrimSpace(ip) == "" { ip = firstIP() }
    id := machineStableID(hostname)
    instanceID := readInstanceID("/opt/core-service/xagent-server/etc/xagent.yaml")
    cpu1, err := readCPUStat()
    if err != nil { return nil, err }
    time.Sleep(500 * time.Millisecond)
    cpu2, err := readCPUStat()
    if err != nil { return nil, err }
    cpuUsage := calculateCPU(cpu1, cpu2)
    memTotal, memAvail, err := readMemInfo()
    if err != nil { return nil, err }
    memUsed := memTotal - memAvail
    memUsage := percent(memUsed, memTotal)
    diskTotal, diskUsed, err := readDiskUsage("/")
    if err != nil { return nil, err }
    diskUsage := percent(diskUsed, diskTotal)
    ports := map[string]bool{}
    for _, p := range []string{"443", "6379", "8888", "8789"} { ports[p] = checkPort("127.0.0.1:" + p) }
    return &Payload{
        ServerID:    id,
        Hostname:    hostname,
        DisplayName: fallback(displayName, hostname),
        IP:          ip,
        OS:          runtime.GOOS,
        Arch:        runtime.GOARCH,
        InstanceID:  instanceID,
        CPUUsage:    cpuUsage,
        CPUCount:    runtime.NumCPU(),
        MemoryUsage: memUsage,
        MemoryUsed:  memUsed,
        MemoryTotal: memTotal,
        DiskUsage:   diskUsage,
        DiskUsed:    diskUsed,
        DiskTotal:   diskTotal,
        Ports:       ports,
        Metadata: map[string]string{
            "agent_version":   "1.4.0",
            "report_interval": strconv.Itoa(intervalSec),
        },
    }, nil
}

type cpuStat struct { idle, total uint64 }
func readCPUStat() (cpuStat, error) { data, err := os.ReadFile("/proc/stat"); if err != nil { return cpuStat{}, err }; scanner := bufio.NewScanner(bytes.NewReader(data)); for scanner.Scan() { line := scanner.Text(); if strings.HasPrefix(line, "cpu ") { fields := strings.Fields(line); if len(fields) < 8 { return cpuStat{}, fmt.Errorf("invalid /proc/stat") }; var total uint64; vals := make([]uint64, 0, len(fields)-1); for _, f := range fields[1:] { v, _ := strconv.ParseUint(f, 10, 64); vals = append(vals, v); total += v }; idle := vals[3]; if len(vals) > 4 { idle += vals[4] }; return cpuStat{idle: idle, total: total}, nil } }; return cpuStat{}, fmt.Errorf("cpu line not found") }
func calculateCPU(a, b cpuStat) float64 { totald := float64(b.total - a.total); idled := float64(b.idle - a.idle); if totald <= 0 { return 0 }; return (1.0 - idled/totald) * 100 }
func readMemInfo() (uint64, uint64, error) { data, err := os.ReadFile("/proc/meminfo"); if err != nil { return 0, 0, err }; var total, avail uint64; scanner := bufio.NewScanner(bytes.NewReader(data)); for scanner.Scan() { line := scanner.Text(); if strings.HasPrefix(line, "MemTotal:") { fields := strings.Fields(line); total, _ = strconv.ParseUint(fields[1], 10, 64); total *= 1024 }; if strings.HasPrefix(line, "MemAvailable:") { fields := strings.Fields(line); avail, _ = strconv.ParseUint(fields[1], 10, 64); avail *= 1024 } }; if total == 0 { return 0, 0, fmt.Errorf("meminfo parse failed") }; return total, avail, nil }
func readDiskUsage(path string) (uint64, uint64, error) { var stat syscall.Statfs_t; if err := syscall.Statfs(path, &stat); err != nil { return 0, 0, err }; total := stat.Blocks * uint64(stat.Bsize); free := stat.Bavail * uint64(stat.Bsize); used := total - free; return total, used, nil }
func checkPort(addr string) bool { conn, err := net.DialTimeout("tcp", addr, 1200*time.Millisecond); if err != nil { return false }; _ = conn.Close(); return true }
func report(url string, payload *Payload) error { body, _ := json.Marshal(payload); req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body)); req.Header.Set("Content-Type", "application/json"); client := &http.Client{Timeout: 8 * time.Second}; resp, err := client.Do(req); if err != nil { return err }; defer resp.Body.Close(); if resp.StatusCode >= 300 { return fmt.Errorf("unexpected status %d", resp.StatusCode) }; return nil }
func readInstanceID(filePath string) string { data, err := os.ReadFile(filePath); if err != nil { return "" }; scanner := bufio.NewScanner(bytes.NewReader(data)); for scanner.Scan() { line := strings.TrimSpace(scanner.Text()); if strings.HasPrefix(line, "InstanceId:") { return strings.TrimSpace(strings.TrimPrefix(line, "InstanceId:")) } }; return "" }
func machineStableID(hostname string) string { candidates := []string{}; for _, p := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} { if b, err := os.ReadFile(p); err == nil { v := strings.TrimSpace(string(b)); if v != "" { candidates = append(candidates, v); break } } }; if b, err := os.ReadFile("/sys/class/dmi/id/product_uuid"); err == nil { v := strings.TrimSpace(string(b)); if v != "" { candidates = append(candidates, v) } }; candidates = append(candidates, hostname); return stableID(strings.Join(candidates, "|")) }
func stableID(input string) string { sum := sha1.Sum([]byte(input)); return hex.EncodeToString(sum[:12]) }
func publicIP() string { urls := []string{"https://api.ipify.org", "https://ifconfig.me/ip", "https://ipv4.icanhazip.com"}; client := &http.Client{Timeout: 4 * time.Second}; for _, url := range urls { req, _ := http.NewRequest(http.MethodGet, url, nil); resp, err := client.Do(req); if err != nil { continue }; data, _ := io.ReadAll(io.LimitReader(resp.Body, 128)); _ = resp.Body.Close(); ip := strings.TrimSpace(string(data)); parsed := net.ParseIP(ip); if parsed != nil && parsed.To4() != nil { return ip } }; return "" }
func firstIP() string { ifaces, err := net.Interfaces(); if err != nil { return "" }; for _, iface := range ifaces { if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 { continue }; addrs, _ := iface.Addrs(); for _, addr := range addrs { var ip net.IP; switch v := addr.(type) { case *net.IPNet: ip = v.IP; case *net.IPAddr: ip = v.IP }; if ip == nil || ip.IsLoopback() { continue }; ipv4 := ip.To4(); if ipv4 != nil { return ipv4.String() } } }; return "" }
func percent(used, total uint64) float64 { if total == 0 { return 0 }; return (float64(used) / float64(total)) * 100 }
func getEnv(key, fallbackVal string) string { val := strings.TrimSpace(os.Getenv(key)); if val == "" { return fallbackVal }; return val }
func getEnvInt(key string, fallbackVal int) int { raw := strings.TrimSpace(os.Getenv(key)); if raw == "" { return fallbackVal }; val, err := strconv.Atoi(raw); if err != nil { return fallbackVal }; return val }
func fallback(v, d string) string { if strings.TrimSpace(v) == "" { return d }; return v }
