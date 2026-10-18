param([string]$OutputDir = 'assets/billboards')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root $OutputDir
[System.IO.Directory]::CreateDirectory($out) | Out-Null
$logo = [System.Drawing.Image]::FromFile((Join-Path $root 'assets/billboards/washoi-logo.png'))
$cyan = [System.Drawing.Color]::FromArgb(25,235,237)
$yellow = [System.Drawing.Color]::FromArgb(255,209,38)
$pink = [System.Drawing.Color]::FromArgb(239,45,170)
function Text($g,$value,$size,$color,$x,$y,$w,$h) {
  $font = New-Object System.Drawing.Font 'Arial', $size, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush $color
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($value,$font,$brush,([System.Drawing.RectangleF]::new($x,$y,$w,$h)),$format)
  $font.Dispose(); $brush.Dispose(); $format.Dispose()
}
function Panel($name,$w,$h,$variant,$vertical,$headline,$footer) {
  $bmp = New-Object System.Drawing.Bitmap $w,$h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::FromArgb(9,16,31))
  $accent = @($cyan,$yellow,$pink)[$variant % 3]
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(30,$accent)),1
  for($x=-$h;$x -lt $w;$x+=48){$g.DrawLine($pen,$x,0,($x+$h),$h)}
  $pen.Dispose()
  $brush=New-Object System.Drawing.SolidBrush $accent
  $g.FillRectangle($brush,0,0,$w,8); $g.FillRectangle($brush,0,($h-8),$w,8)
  if($vertical){
    $logoW=$w-24; $logoH=[int]($logo.Height*$logoW/$logo.Width)
    $g.DrawImage($logo,12,32,$logoW,$logoH)
    $chars=$headline.ToCharArray();$top=[int]($logoH+66);$space=[int](($h-$top-90)/$chars.Count)
    for($i=0;$i -lt $chars.Count;$i++){Text $g ([string]$chars[$i]) ([Math]::Min(82,$space)) $accent 0 ($top+$i*$space) $w $space}
    Text $g $footer ([Math]::Min(23,$w/11)) ([System.Drawing.Color]::White) 10 ($h-70) ($w-20) 42
  }else{
    if($h -ge 400){
      Text $g 'THE ARENA IS YOURS' 21 $accent 24 28 ($w-48) 32
      $logoW=[int]($w*0.78);$logoH=[int]($logo.Height*$logoW/$logo.Width)
      $g.DrawImage($logo,[int](($w-$logoW)/2),[int](($h-$logoH)/2-8),$logoW,$logoH)
      Text $g $headline 25 ([System.Drawing.Color]::White) 24 ($h-95) ($w-48) 38
      Text $g $footer 17 $accent 24 ($h-54) ($w-48) 28
    }else{
      $logoW=[int]($w*0.29);$logoH=[int]($logo.Height*$logoW/$logo.Width)
      $g.DrawImage($logo,14,[int](($h-$logoH)/2),$logoW,$logoH)
      $left=[int]($w*0.34)
      Text $g $headline ([int]($h*0.24)) $accent $left ([int]($h*0.17)) ($w-$left-12) ([int]($h*0.4))
      Text $g $footer ([int]($h*0.12)) ([System.Drawing.Color]::White) $left ([int]($h*0.59)) ($w-$left-12) ([int]($h*0.24))
    }
  }
  $brush.Dispose();$g.Dispose()
  $bmp.Save((Join-Path $out $name),[System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Panel 'bigbill1.png' 1024 512 0 $false 'MOVE FAST. HIT HARD.' 'WASHOI.NET / ENTER THE ARENA'
Panel 'bigbill2.png' 1024 512 1 $false 'YOUR NEXT RIVAL IS WAITING.' 'WASHOI.NET / DUEL / FFA'
Panel 'bigbill5.png' 1024 512 2 $false 'KEEP YOUR MOMENTUM.' 'WASHOI.NET / JUMP / SLIDE / REPEAT'
Panel 'bigbill6.png' 1024 512 0 $false 'ONE MORE ROUND.' 'WASHOI.NET / ENTER THE ARENA'
Panel 'neon1.png' 256 1024 2 $true 'WASHOI' 'WASHOI.NET'
Panel 'small1.png' 512 128 1 $false 'TELEPORT' 'KEEP MOVING >>'
Panel 'small3.png' 1024 256 0 $false 'ARENA OPEN' 'WASHOI.NET / PLAY ALL NIGHT'
Panel 'ver3.png' 256 1024 1 $true 'ARENA' 'DUEL / FFA'
Panel 'bigver1.png' 256 512 0 $true 'DUEL' 'WASHOI.NET'
$logo.Dispose()
Write-Output "Rendered 9 billboard images to $out"
