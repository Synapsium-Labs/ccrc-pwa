//go:build !windows

package regfs

// native is the path itself off Windows (native_windows.go).
func native(p string) string { return p }
