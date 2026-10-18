// Baxandall teleglow_02: archived effect with a DM2 material alias.
textures/baxandall/teleglow_02
{
    cull none
	qer_editorimage textures/baxandall/teleglow_01.tga
	qer_trans 0.50
	deformVertexes autosprite
    surfaceparm trans
	surfaceparm nonsolid
	surfaceparm nomarks
	surfaceparm noimpact
	surfaceparm nolightmap
    nomipmaps
	nopicmip
	{
		clampmap textures/baxandall/teleglow_01.tga
		blendfunc gl_one gl_one
		tcMod stretch sawtooth 1 -.9 0 1.5
		tcMod rotate 60
		rgbGen wave sawtooth .75 .5 .6 1.5
	}
	{
		clampmap textures/baxandall/teleglow_01.tga
		blendfunc gl_one gl_one
		tcMod stretch sawtooth 1 -.9 .5 1.20
		tcMod rotate -20
		rgbGen wave sawtooth .75 .5 .1 1.20
	}
}

textures/wsw_cave1/ball_glowb_portal
{
    cull none
	qer_editorimage textures/baxandall/teleglow_01.tga
	qer_trans 0.50
	deformVertexes autosprite
    surfaceparm trans
	surfaceparm nonsolid
	surfaceparm nomarks
	surfaceparm noimpact
	surfaceparm nolightmap
    nomipmaps
	nopicmip
	{
		clampmap textures/baxandall/teleglow_01.tga
		blendfunc gl_one gl_one
		tcMod stretch sawtooth 1 -.9 0 1.5
		tcMod rotate 60
		rgbGen wave sawtooth .75 .5 .6 1.5
	}
	{
		clampmap textures/baxandall/teleglow_01.tga
		blendfunc gl_one gl_one
		tcMod stretch sawtooth 1 -.9 .5 1.20
		tcMod rotate -20
		rgbGen wave sawtooth .75 .5 .1 1.20
	}
}
