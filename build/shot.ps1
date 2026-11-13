param(
  [string]$Action = "shot",
  [string]$OutFile = "D:\Project\RelaxCode\build\installer\shot.png",
  [int]$X = 0,
  [int]$Y = 0
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process | Where-Object { ($_.ProcessName -like 'RelaxCode-Setup*' -or $_.MainWindowTitle -like '*RelaxCode*') } | Select-Object -First 1

if ($Action -eq "click") {
  [Win]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 150
  [Win]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [Win]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Write-Output "clicked $X,$Y"
  exit 0
}

if ($null -eq $proc) { Write-Output "window not found"; exit 1 }
$r = New-Object Win+RECT
[Win]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null

if ($Action -eq "rect") {
  Write-Output "rect: $($r.Left),$($r.Top) size: $($r.Right - $r.Left)x$($r.Bottom - $r.Top)"
  exit 0
}

$width = $r.Right - $r.Left
$height = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT = 2 — captures the real window content even when covered
[Win]::PrintWindow($proc.MainWindowHandle, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $OutFile ($width x $height)"
