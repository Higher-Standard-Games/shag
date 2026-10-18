$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'assets/billboards'
$gold = [System.Drawing.Color]::FromArgb(255,210,40)
$logo = [System.Drawing.Image]::FromFile((Join-Path $out 'washoi-logo.png'))

# Additive material: black contributes no light; the gold strokes form the sign.
$neon = New-Object System.Drawing.Bitmap 512,128
$g = [System.Drawing.Graphics]::FromImage($neon)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Black)
$letters = New-Object System.Drawing.Drawing2D.GraphicsPath
$font = New-Object System.Drawing.FontFamily 'Arial'
$letters.AddString('WASHOI',$font,([int][System.Drawing.FontStyle]::Bold),83,([System.Drawing.PointF]::new(0,0)),[System.Drawing.StringFormat]::GenericDefault)
$bounds = $letters.GetBounds()
$transform = New-Object System.Drawing.Drawing2D.Matrix
$transform.Translate((256-$bounds.Width/2-$bounds.X),(61-$bounds.Height/2-$bounds.Y))
$letters.Transform($transform)
foreach($width in @(12,8,4)) {
  $opacity = if($width -eq 4){255}else{35}
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($opacity,$gold)),$width
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($pen,$letters)
  $pen.Dispose()
}
$pen = New-Object System.Drawing.Pen $gold,3
$g.DrawRectangle($pen,20,12,472,104)
$g.DrawLine($pen,68,101,444,101)
$neon.Save((Join-Path $out 'dm2_neon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$pen.Dispose();$transform.Dispose();$letters.Dispose();$font.Dispose();$g.Dispose();$neon.Dispose()

# Transparent decal: preserve the original central badge footprint in its square UVs.
$badge = New-Object System.Drawing.Bitmap 912,912
$g = [System.Drawing.Graphics]::FromImage($badge)
$g.Clear([System.Drawing.Color]::Transparent)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$points = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(456,164),[System.Drawing.PointF]::new(688,298),
  [System.Drawing.PointF]::new(688,566),[System.Drawing.PointF]::new(456,700),
  [System.Drawing.PointF]::new(224,566),[System.Drawing.PointF]::new(224,298)
)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(28,30,34))
$g.FillPolygon($brush,$points)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(174,176,177)),12
$g.DrawPolygon($pen,$points)
$pen.Dispose()
$pen = New-Object System.Drawing.Pen $gold,3
$g.DrawLine($pen,280,548,632,548)
$logoW=440; $logoH=[int]($logo.Height*$logoW/$logo.Width)
$g.DrawImage($logo,236,[int](420-$logoH/2),$logoW,$logoH)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$font = New-Object System.Drawing.Font 'Arial',24,([System.Drawing.FontStyle]::Bold),([System.Drawing.GraphicsUnit]::Pixel)
$textBrush = New-Object System.Drawing.SolidBrush $gold
$g.DrawString('WASHOI.NET',$font,$textBrush,([System.Drawing.RectangleF]::new(250,570,412,40)),$format)
$badge.Save((Join-Path $out 'dm2_atrium.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$textBrush.Dispose();$font.Dispose();$format.Dispose();$pen.Dispose();$brush.Dispose();$g.Dispose();$badge.Dispose();$logo.Dispose()
Write-Output 'Rendered DM2 gold neon and transparent atrium badge'
