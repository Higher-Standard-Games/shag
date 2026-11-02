$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'assets/billboards'
$yellow = [System.Drawing.Color]::FromArgb(255,209,38)
$cyan = [System.Drawing.Color]::FromArgb(25,235,237)
$red = [System.Drawing.Color]::FromArgb(255,32,24)
$logo = [System.Drawing.Image]::FromFile((Join-Path $out 'washoi-logo.png'))
function Text($g,$value,$size,$color,$x,$y,$w,$h) {
  $font = New-Object System.Drawing.Font 'Arial', $size, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush $color
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($value,$font,$brush,([System.Drawing.RectangleF]::new($x,$y,$w,$h)),$format)
  $font.Dispose(); $brush.Dispose(); $format.Dispose()
}

# Ammo sign (additive). Its sign model shows only u 0.125-0.875, v 0.25-0.75,
# so everything sits inside x 64-448, y 64-192.
$sign = New-Object System.Drawing.Bitmap 512,256
$g = [System.Drawing.Graphics]::FromImage($sign)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(6,22,48))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40,$cyan)),1
for($x=-256;$x -lt 512;$x+=32){$g.DrawLine($pen,$x,0,($x+256),256)}
$pen.Dispose()
$brush = New-Object System.Drawing.SolidBrush $cyan
$g.FillRectangle($brush,64,64,384,6); $g.FillRectangle($brush,64,186,384,6)
$brush.Dispose()
$logoW=150; $logoH=[int]($logo.Height*$logoW/$logo.Width)
$g.DrawImage($logo,74,[int](128-$logoH/2),$logoW,$logoH)
Text $g 'AMMO' 46 $yellow 230 78 210 60
Text $g 'LOCK AND LOAD' 20 ([System.Drawing.Color]::White) 230 136 210 40
$sign.Save((Join-Path $out 'bulletsblue2.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $sign.Dispose()

# Vertical red neon (additive, five animation frames): frame N lights the
# first letters, then the full word. The panel shows v 0.105-0.918.
$letters = 'WASHOI'.ToCharArray()
$lit = @(1,2,3,4,6)
for($frame=0;$frame -lt 5;$frame++) {
  $neon = New-Object System.Drawing.Bitmap 64,512
  $g = [System.Drawing.Graphics]::FromImage($neon)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Black)
  $family = New-Object System.Drawing.FontFamily 'Arial'
  for($i=0;$i -lt $lit[$frame];$i++) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddString([string]$letters[$i],$family,([int][System.Drawing.FontStyle]::Bold),54,([System.Drawing.PointF]::new(0,0)),[System.Drawing.StringFormat]::GenericDefault)
    $bounds = $path.GetBounds()
    $matrix = New-Object System.Drawing.Drawing2D.Matrix
    $matrix.Translate((32-$bounds.Width/2-$bounds.X),(88+$i*68-$bounds.Height/2-$bounds.Y))
    $path.Transform($matrix)
    foreach($width in @(9,6,3)) {
      $opacity = if($width -eq 3){255}else{45}
      $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($opacity,$red)),$width
      $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
      $g.DrawPath($pen,$path)
      $pen.Dispose()
    }
    $matrix.Dispose(); $path.Dispose()
  }
  $family.Dispose()
  $neon.Save((Join-Path $out ("amphi2_neon{0}.png" -f ($frame+1))),[System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $neon.Dispose()
}
$logo.Dispose()
Write-Output 'Rendered the Amphi2 ammo sign and five red neon frames'
