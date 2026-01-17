# Shader Templates Research

## Overview

Warsow/QFusion extends the Quake 3 shader format with **template support**. This allows shader authors to define reusable shader "templates" that can be instantiated with parameters, reducing copy-paste and keeping shader files DRY.

## Template Syntax

### Template Definition

Templates are defined with a name ending in `_Template` (or possibly just using `template` keyword):

```shader
simpleitem_Template
{
    nopicmip
    entityMergable
    {
        map gfx/simpleitems/$1/$2.tga
        blendFunc GL_SRC_ALPHA GL_ONE_MINUS_SRC_ALPHA
        alphagen entity
    }
}
```

- `$1`, `$2`, `$3`, etc. are **parameter placeholders**
- When the template is instantiated, these get replaced with actual values

### Template Instantiation

To use a template, you specify the template name and parameters:

```shader
gfx/simpleitems/weapons/plasmagun
{
    template simpleitem_Template weapons plasmagun
}
```

This expands to:
```shader
gfx/simpleitems/weapons/plasmagun
{
    nopicmip
    entityMergable
    {
        map gfx/simpleitems/weapons/plasmagun.tga
        blendFunc GL_SRC_ALPHA GL_ONE_MINUS_SRC_ALPHA
        alphagen entity
    }
}
```

## Implementation Plan

### Phase 1: Template Collection (Preprocessing)

1. **First Pass**: Scan all shader files for template definitions
   - Identify shaders with names ending in `_Template` OR containing `template` directive
   - Store template name → template body mapping
   - Do NOT register templates as actual shaders

2. **Data Structure**:
   ```typescript
   interface ShaderTemplate {
       name: string;           // e.g., "simpleitem_Template"
       paramCount: number;     // Number of $N placeholders found
       rawBody: string;        // Raw shader body with $N placeholders
   }
   
   // In Q3ShaderRegistry
   private templates: Map<string, ShaderTemplate> = new Map();
   ```

### Phase 2: Template Expansion

1. **Second Pass**: When parsing shader that uses `template` directive:
   - Extract: `template <templateName> <param1> <param2> ...`
   - Look up template in registry
   - Clone template body
   - Replace `$1` with param1, `$2` with param2, etc.
   - Parse the expanded result as normal shader body

2. **Expansion Logic**:
   ```typescript
   function expandTemplate(
       templateName: string, 
       params: string[]
   ): string {
       const template = this.templates.get(templateName);
       if (!template) return null;
       
       let expanded = template.rawBody;
       for (let i = 0; i < params.length; i++) {
           expanded = expanded.replace(
               new RegExp(`\\$${i + 1}`, 'g'), 
               params[i]
           );
       }
       return expanded;
   }
   ```

### Phase 3: Parser Integration

Modify `Q3ShaderParser.ts`:

1. **In `parseShaderFile`**:
   - Check if shader name ends with `_Template`
   - If yes, store as template instead of parsing as shader

2. **In `parseShaderBody`**:
   - Add case for `template` directive
   - When found, expand the template and process result

### Phase 4: Two-Pass Loading

Modify `Q3ShaderRegistry.ts`:

1. **Pass 1**: Load all shader files, extract templates
2. **Pass 2**: Parse shader files again, expanding templates as needed

OR simpler approach:

1. Single pass but collect templates first within each file
2. When encountering template usage, look up and expand

## Edge Cases

- Template not found → fallback to treating as unknown directive
- Parameter count mismatch → use empty string for missing params
- Nested templates → probably not supported, keep it simple
- Template in different file → templates should be global across all loaded shaders

## Files to Modify

1. `src/engine/loader/shader/Q3ShaderParser.ts`
   - Add template detection
   - Add template expansion during parsing
   - Handle `template` directive

2. `src/engine/loader/shader/Q3ShaderRegistry.ts`
   - Add template storage
   - Modify loading to handle templates
   - Possibly two-pass loading

3. `src/engine/loader/shader/Q3ShaderTypes.ts`
   - Add `ShaderTemplate` interface (optional, could be inline)

## Testing

1. Create test shader file with template definition and usage
2. Verify template expands correctly
3. Verify material is created with correct properties
4. Test with actual Warsow plasma shaders

## Priority

This is important for weapon effects (muzzle flash, projectiles, impacts) which rely heavily on shader templates in Warsow assets.
