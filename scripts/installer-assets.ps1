<#
.SYNOPSIS
  Renders the RelaxCode installer art (BMP assets + PNG page previews) from
  a JSON spec produced by scripts/build-installer-assets.mjs, using GDI+.
#>
param(
  [Parameter(Mandatory = $true)][string]$Spec
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$specPath = $Spec
$specData = Get-Content -Raw -Encoding UTF8 $specPath | ConvertFrom-Json
$assetsDir = $specData.assetsDir
$previewDir = $specData.previewDir

$fonts = New-Object System.Drawing.Text.PrivateFontCollection
$fonts.AddFontFile($specData.fontFile)

function Get-Color([string]$hex) {
  $h = $hex.TrimStart('#')
  $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
  if ($h.Length -ge 8) {
    $a = [Convert]::ToInt32($h.Substring(6, 2), 16)
    return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
  }
  return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
}

function Get-BrandFont([string]$family, [int]$size) {
  $fam = $null
  foreach ($f in $fonts.Families) {
    if ($f.Name -eq $family) { $fam = $f; break }
  }
  if ($fam -eq $null) {
    Write-Warning "font family '$family' not found, falling back to Segoe UI"
    $fam = New-Object System.Drawing.FontFamily('Segoe UI')
  }
  return New-Object System.Drawing.Font($fam, $size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
}

function New-RoundPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $d = $r * 2
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($d -le 0 -or $d -gt $w -or $d -gt $h) {
    $p.AddRectangle([System.Drawing.RectangleF]::new($x, $y, $w, $h))
    return $p
  }
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Invoke-Op($g, $op, [string]$assetsDir) {
  $t = $op.t
  if ($t -eq 'rect') {
    $b = New-Object System.Drawing.SolidBrush((Get-Color $op.fill))
    $g.FillRectangle($b, [single]$op.x, [single]$op.y, [single]$op.w, [single]$op.h)
    $b.Dispose()
  }
  elseif ($t -eq 'grad') {
    $rect = [System.Drawing.RectangleF]::new([single]$op.x, [single]$op.y, [single]$op.w, [single]$op.h)
    $b = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, (Get-Color $op.from), (Get-Color $op.to), 90)
    $g.FillRectangle($b, $rect)
    $b.Dispose()
  }
  elseif ($t -eq 'round') {
    $path = New-RoundPath $op.x $op.y $op.w $op.h $op.r
    if ($op.PSObject.Properties['fill'] -and $op.fill) {
      if ($op.PSObject.Properties['fill2'] -and $op.fill2) {
        $rect = [System.Drawing.RectangleF]::new([single]$op.x, [single]$op.y, [single]$op.w, [single]$op.h)
        $b = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, (Get-Color $op.fill), (Get-Color $op.fill2), 90)
        $g.FillPath($b, $path)
        $b.Dispose()
      } else {
        $b = New-Object System.Drawing.SolidBrush((Get-Color $op.fill))
        $g.FillPath($b, $path)
        $b.Dispose()
      }
    }
    if ($op.PSObject.Properties['stroke'] -and $op.stroke) {
      $strokeWidth = 1
      if ($op.PSObject.Properties['sw'] -and $op.sw) { $strokeWidth = [single]$op.sw }
      $pen = New-Object System.Drawing.Pen((Get-Color $op.stroke), $strokeWidth)
      $g.DrawPath($pen, $path)
      $pen.Dispose()
    }
    $path.Dispose()
  }
  elseif ($t -eq 'circle') {
    $rect = [System.Drawing.RectangleF]::new([single]($op.cx - $op.r), [single]($op.cy - $op.r), [single]($op.r * 2), [single]($op.r * 2))
    if ($op.PSObject.Properties['fill'] -and $op.fill) {
      $b = New-Object System.Drawing.SolidBrush((Get-Color $op.fill))
      $g.FillEllipse($b, $rect)
      $b.Dispose()
    }
    if ($op.PSObject.Properties['stroke'] -and $op.stroke) {
      $pen = New-Object System.Drawing.Pen((Get-Color $op.stroke), [single]$op.sw)
      $g.DrawEllipse($pen, $rect)
      $pen.Dispose()
    }
  }
  elseif ($t -eq 'arc') {
    $pen = New-Object System.Drawing.Pen((Get-Color $op.color), [single]$op.sw)
    $g.DrawArc($pen, [single]($op.cx - $op.rx), [single]($op.cy - $op.ry), [single]($op.rx * 2), [single]($op.ry * 2), [single]$op.start, [single]$op.sweep)
    $pen.Dispose()
  }
  elseif ($t -eq 'glow') {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse([single]($op.cx - $op.rx), [single]($op.cy - $op.ry), [single]($op.rx * 2), [single]($op.ry * 2))
    $c0 = (Get-Color $op.color)
    $b = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
    $b.CenterColor = $c0
    $b.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $c0.R, $c0.G, $c0.B))
    $b.FocusScales = [System.Drawing.PointF]::new(0.55, 0.55)
    $g.FillPath($b, $path)
    $b.Dispose()
    $path.Dispose()
  }
  elseif ($t -eq 'img') {
    $srcPath = $op.src
    if (-not [IO.Path]::IsPathRooted($srcPath)) { $srcPath = Join-Path $assetsDir $srcPath }
    try {
      $img = New-Object System.Drawing.Bitmap($srcPath)
    } catch {
      throw ("cannot load image [" + $srcPath + "] type=" + $srcPath.GetType().Name + ": " + $_.Exception.Message)
    }
    if ($op.PSObject.Properties['w'] -and $op.w) {
      $g.DrawImage($img, [single]$op.x, [single]$op.y, [single]$op.w, [single]$op.h)
    } else {
      $g.DrawImage($img, [single]$op.x, [single]$op.y)
    }
    $img.Dispose()
  }
  elseif ($t -eq 'text') {
    $font = Get-BrandFont $op.family ([int]$op.size)
    $brush = New-Object System.Drawing.SolidBrush((Get-Color $op.color))
    $x = [single]$op.x
    $align = 'l'
    if ($op.PSObject.Properties['align'] -and $op.align) { $align = $op.align }
    if ($align -ne 'l') {
      $size = $g.MeasureString($op.text, $font)
      if ($align -eq 'c') { $x = $x - $size.Width / 2 } else { $x = $x - $size.Width }
    }
    $g.DrawString($op.text, $font, $brush, $x, [single]$op.y)
    $brush.Dispose()
    $font.Dispose()
  }
  elseif ($t -eq 'line') {
    $pen = New-Object System.Drawing.Pen((Get-Color $op.color), [single]$op.sw)
    $g.DrawLine($pen, [single]$op.x1, [single]$op.y1, [single]$op.x2, [single]$op.y2)
    $pen.Dispose()
  }
  elseif ($t -eq 'check') {
    $pen = New-Object System.Drawing.Pen((Get-Color $op.color), [single]$op.sw)
    $pen.StartCap = 'Round'
    $pen.EndCap = 'Round'
    $s = [single]$op.size
    $pts = @(
      [System.Drawing.PointF]::new([single]($op.x), [single]($op.y + $s * 0.5)),
      [System.Drawing.PointF]::new([single]($op.x + $s * 0.38), [single]($op.y + $s * 0.9)),
      [System.Drawing.PointF]::new([single]($op.x + $s), [single]($op.y))
    )
    $g.DrawLines($pen, $pts)
    $pen.Dispose()
  }
  elseif ($t -eq 'clip') {
    $path = New-RoundPath $op.x $op.y $op.w $op.h $op.r
    $g.SetClip($path)
    $path.Dispose()
  }
  elseif ($t -eq 'clipEnd') {
    $g.ResetClip()
  }
  else {
    throw "unknown op: $t"
  }
}

function Render-File($f) {
  Write-Host ("  rendering " + $f.name)
  $bmp = New-Object System.Drawing.Bitmap([int]$f.width, [int]$f.height)
  $bmp.SetResolution(96, 96)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.InterpolationMode = 'HighQualityBicubic'
  foreach ($op in $f.ops) { Invoke-Op $g $op $assetsDir }
  $bmp.Save((Join-Path $assetsDir $f.name), [System.Drawing.Imaging.ImageFormat]::Bmp)

  $previewName = $f.name -replace '\.bmp$', '.png'
  $p = New-Object System.Drawing.Bitmap([int]$f.width, [int]$f.height)
  $p.SetResolution(96, 96)
  $gp = [System.Drawing.Graphics]::FromImage($p)
  $gp.SmoothingMode = 'AntiAlias'
  $gp.TextRenderingHint = 'AntiAliasGridFit'
  $gp.InterpolationMode = 'HighQualityBicubic'
  foreach ($op in $f.ops) { Invoke-Op $gp $op $assetsDir }
  if ($f.PSObject.Properties['previewExtras'] -and $f.previewExtras) {
    foreach ($op in $f.previewExtras) { Invoke-Op $gp $op $assetsDir }
  }
  if ($f.PSObject.Properties['previewButtons'] -and $f.previewButtons) {
    foreach ($pb in $f.previewButtons) {
      $imgOp = New-Object PSObject -Property @{ t = 'img'; src = $pb.asset; x = $pb.x; y = $pb.y; w = $pb.w; h = $pb.h }
      Invoke-Op $gp $imgOp $assetsDir
    }
  }
  $p.Save((Join-Path $previewDir $previewName), [System.Drawing.Imaging.ImageFormat]::Png)

  $g.Dispose(); $bmp.Dispose()
  $gp.Dispose(); $p.Dispose()
}

foreach ($f in $specData.files) { Render-File $f }
Write-Host ("rendered {0} assets + previews" -f $specData.files.Count)
