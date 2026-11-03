# Sample master bedroom fixture provenance

## Source

- **Canonical Commons page:** [File:400 Family Housing Units 2 Bedroom Unit Typical Floor Plans, July 24, 1989 - DPLA - c7a8b82ce8562d0a20b33b02d2f5f6fd.tiff](https://commons.wikimedia.org/wiki/File:400_Family_Housing_Units_2_Bedroom_Unit_Typical_Floor_Plans,_July_24,_1989_-_DPLA_-_c7a8b82ce8562d0a20b33b02d2f5f6fd.tiff)
- **Source title:** `400 Family Housing Units 2 Bedroom Unit Typical Floor Plans, July 24, 1989`
- **Original TIFF:** [Wikimedia Commons upload](https://upload.wikimedia.org/wikipedia/commons/2/2e/400_Family_Housing_Units_2_Bedroom_Unit_Typical_Floor_Plans%2C_July_24%2C_1989_-_DPLA_-_c7a8b82ce8562d0a20b33b02d2f5f6fd.tiff)
- **Processing preview:** [3840px JPEG preview](https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/400_Family_Housing_Units_2_Bedroom_Unit_Typical_Floor_Plans%2C_July_24%2C_1989_-_DPLA_-_c7a8b82ce8562d0a20b33b02d2f5f6fd.tiff/lossy-page1-3840px-400_Family_Housing_Units_2_Bedroom_Unit_Typical_Floor_Plans%2C_July_24%2C_1989_-_DPLA_-_c7a8b82ce8562d0a20b33b02d2f5f6fd.tiff.jpg)
- **NARA ID:** `167060897`
- **DPLA ID:** `c7a8b82ce8562d0a20b33b02d2f5f6fd`
- **Creator / author:** No individual drafter is identified in the Commons/DPLA fixture metadata;
  the U.S. federal record is held by the National Archives and Records Administration.
- **Required attribution:** None under the Commons `PD-US` marking.

Wikimedia Commons identifies the source as public domain in the United States (`PD-US`) and says attribution is not required. The work may not be in the public domain outside the United States, particularly in territories that do not apply the rule of the shorter term to United States works. Legal review is required before relying on its public-domain status for wider or non-US distribution.

## Derivation

The committed fixture is `public/assets/floor-plan/sample-master-bedroom.png`.

1. Start with the actual `3840 x 2840` Wikimedia JPEG preview.
2. Crop Pillow coordinates `(1660, 1180, 2000, 1540)`, producing `340 x 360` pixels.
3. Resize to `1020 x 1080` with Lanczos resampling.
4. Increase contrast by a factor of `1.35`.
5. Apply one Pillow `ImageFilter.SHARPEN` pass.
6. Save as PNG.

The recipe was run with Pillow `12.3.0`. No annotation, inpainting, geometry change, or other architectural-content edit was applied.

## Verification

- **Original TIFF dimensions:** `8264 x 6112`
- **Preview dimensions:** `3840 x 2840`
- **Derived dimensions:** `1020 x 1080`
- **Derived pixels:** `1,101,600`
- **Derived byte length:** `194,686`
- **PNG signature:** `89 50 4e 47 0d 0a 1a 0a`
- **SHA-256:** `02c90be495d1f64e8adb57c4d00eb81f09fbeb80e885a0066f692026d2145587`

The crop was visually inspected and contains the empty `MASTER BEDROOM`, one inward-swinging door, exterior window/wall detail, and the printed room dimensions of approximately `11'-10 3/4"` by `13'-0"`.

## Application support boundary

The optional New Home demo accepts only these exact committed PNG bytes. The main process requires
the documented PNG format, `1020 x 1080` dimensions, `194,686`-byte length, and SHA-256 before
analysis or import. A renamed byte-identical copy is allowed; modified, re-encoded, or arbitrary
images are rejected and never receive the fixture's canonical geometry.

The local VLM classifies only independent visible evidence for a rectangular room-like boundary, a
printed room label, an architectural door opening or swing, and an architectural window opening.
The application—not the VLM—applies the documented `3650 x 3950 mm` scale and canonical
door/window/closet/clearance geometry. No VLM output supplies millimetres, hinges, coordinates, or a
fit verdict.

This derived asset is for use only as a private demo fixture for the optional New Home feature unless legal review approves wider distribution.
