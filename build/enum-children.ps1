Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WEnum {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lparam);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public struct RECT { public int L, T, R, B; }
}
"@
$p = Get-Process | Where-Object { $_.ProcessName -like 'RelaxCode-Setup*' } | Select-Object -First 1
$parent = $p.MainWindowHandle
Write-Output "parent: $parent"
$script:out = New-Object System.Collections.Generic.List[string]
$cb = [WEnum+EnumProc]{
  param($h, $l)
  $cn = New-Object System.Text.StringBuilder 128
  [WEnum]::GetClassName($h, $cn, 128) | Out-Null
  $tx = New-Object System.Text.StringBuilder 128
  [WEnum]::GetWindowText($h, $tx, 128) | Out-Null
  $r = New-Object WEnum+RECT
  [WEnum]::GetWindowRect($h, [ref]$r) | Out-Null
  $vis = [WEnum]::IsWindowVisible($h)
  $script:out.Add("hwnd=$h class=[$($cn.ToString())] text=[$($tx.ToString())] rect=$($r.L),$($r.T) $($r.R - $r.L)x $($r.B - $r.T)h vis=$vis")
  return $true
}
[WEnum]::EnumChildWindows($parent, $cb, [IntPtr]::Zero) | Out-Null
$script:out | ForEach-Object { Write-Output $_ }
Write-Output ("total children: " + $script:out.Count)
