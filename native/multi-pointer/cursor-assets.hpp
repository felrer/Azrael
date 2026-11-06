#pragma once

#include <array>
#include <cstdint>

// Frozen approved cursor preview data. See CURSOR-NOTICES.md for attribution.
// Circular SVG arcs converted offline to cubic Beziers, each sweep <= 90 degrees.
// Types are GDI+ PathPointType: Start=0, Line=1, Bezier=3, CloseSubpath=0x80.
namespace mp::cursor_assets {

struct PathPoint { float x, y; unsigned char type; };

inline constexpr char previewSource[] = "work/EZ-01-window-use-multipointer-review/cursor-motion-preview.html";
inline constexpr char previewSha256[] = "cc60b5b2effdf8719ac4e92e99b17994e73617919370c720cd208593fb87732c";
inline constexpr char upstreamCommit[] = "9eb184e96268d3293462f9d9d19225b4c7b07774";
inline constexpr char upstreamSvgSha256[] = "b107bfe61b65166d2cbd5f8316168d88a993fbf1ad3f4c5dbc53f5ea9e2fc164";
inline constexpr char upstreamSvgSource[] = "https://github.com/microsoft/fluentui-system-icons/blob/9eb184e96268d3293462f9d9d19225b4c7b07774/assets/Cursor/SVG/ic_fluent_cursor_16_filled.svg";
inline constexpr char windowsReferenceSha256[] = "06678bbf954f0bece61062633dc63a52a34a6f3c27ac7108f28c0f0d26bb22a7";
inline constexpr char windowsReferenceSource[] = "C:/Windows/Cursors/aero_arrow.cur";
inline constexpr char paletteSourceSha256[] = "dbe1fec89c84b49f8014f6b4b35a8a0df87bd60b913f9acbbb422326ceb7cecf";

// User paths use preview pixel coordinates at hotspot (0,0), without scaling.
inline constexpr std::array<PathPoint, 47> userOuter{{
    {0.46541f, 0.37728f, 0},
    {11.61836f, 11.84888f, 1},
    {11.745981433f, 11.980146418f, 3},
    {11.787818093f, 12.172578983f, 3},
    {11.726217705f, 12.344984015f, 3},
    {11.664617316f, 12.517389047f, 3},
    {11.510308787f, 12.639738855f, 3},
    {11.3284f, 12.66041f, 3},
    {8.18424f, 13.0177f, 1},
    {8.119354034f, 13.025071961f, 3},
    {8.062153572f, 13.063657475f, 3},
    {8.031016271f, 13.121059591f, 3},
    {7.99987897f, 13.178461706f, 3},
    {7.998726824f, 13.247450165f, 3},
    {8.02793f, 13.30586f, 3},
    {9.98111f, 17.21223f, 1},
    {10.07590934f, 17.401833266f, 3},
    {10.00633023f, 17.632468145f, 3},
    {9.82249f, 17.73801f, 3},
    {7.8021f, 18.89787f, 1},
    {7.709201411f, 18.951199548f, 3},
    {7.59879449f, 18.965040456f, 3},
    {7.495606489f, 18.93629285f, 3},
    {7.392418487f, 18.907545245f, 3},
    {7.30507216f, 18.838611378f, 3},
    {7.25313f, 18.74493f, 3},
    {4.75551f, 14.24029f, 1},
    {4.729497531f, 14.193370942f, 3},
    {4.683912549f, 14.160500039f, 3},
    {4.631179654f, 14.150636555f, 3},
    {4.578446759f, 14.14077307f, 3},
    {4.524062573f, 14.154945126f, 3},
    {4.48285f, 14.18929f, 3},
    {0.83388f, 17.2301f, 1},
    {0.709011644f, 17.334156404f, 3},
    {0.535312714f, 17.356821812f, 3},
    {0.387924058f, 17.28829134f, 3},
    {0.240535403f, 17.219760868f, 3},
    {0.145920872f, 17.072339262f, 3},
    {0.14501f, 16.9098f, 3},
    {0.05334f, 0.54593f, 1},
    {0.052790758f, 0.4480011f, 3},
    {0.111795924f, 0.359561019f, 3},
    {0.202429292f, 0.322467035f, 3},
    {0.293062661f, 0.285373052f, 3},
    {0.397142705f, 0.307066415f, 3},
    {0.46541f, 0.37728f, 0x83},
}};

inline constexpr std::array<PathPoint, 47> userInner{{
    {1.26269f, 2.54583f, 0},
    {10.03552f, 11.56931f, 1},
    {10.083375458f, 11.61853444f, 3},
    {10.099063238f, 11.690694208f, 3},
    {10.0759645f, 11.755344333f, 3},
    {10.052865761f, 11.819994457f, 3},
    {9.995003338f, 11.865875592f, 3},
    {9.92679f, 11.87363f, 3},
    {6.96958f, 12.20968f, 1},
    {6.852787949f, 12.222954545f, 3},
    {6.749831694f, 12.29241088f, 3},
    {6.693788493f, 12.395734432f, 3},
    {6.637745292f, 12.499057984f, 3},
    {6.635673974f, 12.623234803f, 3},
    {6.68824f, 12.72837f, 3},
    {8.83636f, 17.02462f, 1},
    {8.879018896f, 17.109941476f, 3},
    {8.847707914f, 17.213726548f, 3},
    {8.76498f, 17.26122f, 3},
    {7.96789f, 17.71881f, 1},
    {7.926085687f, 17.742809661f, 3},
    {7.876401997f, 17.749039152f, 3},
    {7.829966592f, 17.736103252f, 3},
    {7.783531187f, 17.723167353f, 3},
    {7.744224481f, 17.692147063f, 3},
    {7.72085f, 17.64999f, 3},
    {5.13213f, 12.98104f, 1},
    {5.080102879f, 12.887206757f, 3},
    {4.988934089f, 12.821469556f, 3},
    {4.883471164f, 12.801744696f, 3},
    {4.778008238f, 12.782019835f, 3},
    {4.669243442f, 12.810363212f, 3},
    {4.58682f, 12.87905f, 3},
    {1.37192f, 15.55813f, 1},
    {1.318405189f, 15.602725441f, 3},
    {1.243963119f, 15.612439298f, 3},
    {1.180796666f, 15.583069454f, 3},
    {1.117630214f, 15.553699611f, 3},
    {1.077080923f, 15.490519426f, 3},
    {1.07669f, 15.42086f, 3},
    {1.00515f, 2.65123f, 1},
    {1.004810888f, 2.590027263f, 3},
    {1.041689459f, 2.534756694f, 3},
    {1.098333041f, 2.511574921f, 3},
    {1.154976624f, 2.488393149f, 3},
    {1.220023329f, 2.501950104f, 3},
    {1.26269f, 2.54583f, 0x83},
}};

// Model body retains the 16x16 source coordinate system. Preview applies
// x = 2*(x-4.3), y = 2*(y-2.2); white outline is 0.9 source units.
inline constexpr std::array<PathPoint, 25> modelBody{{
    {4.00195f, 2.998859805f, 0},
    {4.00195f, 2.605886307f, 3},
    {4.232112588f, 2.24934094f, 3},
    {4.590234161f, 2.087547527f, 3},
    {4.948355734f, 1.925754114f, 3},
    {5.368041488f, 1.988708731f, 3},
    {5.662930136f, 2.248456407f, 3},
    {12.661012404f, 8.412598761f, 1},
    {12.973184911f, 8.687570632f, 3},
    {13.082516131f, 9.127087122f, 3},
    {12.935554421f, 9.516270189f, 3},
    {12.788592711f, 9.905453256f, 3},
    {12.416038522f, 10.163002159f, 3},
    {12.000032268f, 10.163002159f, 3},
    {8.588736558f, 10.163002159f, 1},
    {8.251127991f, 10.163002159f, 3},
    {7.936311679f, 10.333350833f, 3},
    {7.751627583f, 10.615965994f, 3},
    {5.839058974f, 13.542698176f, 1},
    {5.597069027f, 13.913006337f, 3},
    {5.14053205f, 14.080319692f, 3},
    {4.716563398f, 13.954074494f, 3},
    {4.292594745f, 13.827829296f, 3},
    {4.00195f, 13.438027549f, 3},
    {4.00195f, 12.995662012f, 0x83},
}};

struct PaletteFamily {
    const char* name;
    std::uint32_t bright, pastel, deep, clear, porcelain, luminous;
};

// LAIO appDefaults/eventVariantDefaults: registered defaults, no user overrides.
// Colors are 0xRRGGBB; callers choose opacity separately.
inline constexpr std::array<PaletteFamily, 12> palette{{
    {"Sky Blue", 0x38BDF8u, 0xE0F2FEu, 0x0369A1u, 0x0284C7u, 0xF9FDFFu, 0x008AD0u},
    {"Periwinkle", 0x818CF8u, 0xE0E7FFu, 0x4338CAu, 0x6366F1u, 0xFBFCFFu, 0x676AFFu},
    {"Emerald", 0x34D399u, 0xD2FAE5u, 0x047857u, 0x0AA775u, 0xF5FFFAu, 0x00AE7Au},
    {"Violet", 0xA78BFAu, 0xEDE9FEu, 0x6D28D9u, 0x8B5CF6u, 0xFCFBFFu, 0x9161FFu},
    {"Pink", 0xF472B6u, 0xFCE7F3u, 0xBE185Du, 0xDB2777u, 0xFFFBFCu, 0xE81C7Cu},
    {"Yellow", 0xFDE047u, 0xFFFFD0u, 0xA16207u, 0xDA9E06u, 0xFEFCF3u, 0xE2A400u},
    {"Orange", 0xFB923Cu, 0xFFEDD5u, 0xC2410Cu, 0xF16511u, 0xFFFCF3u, 0xFF6400u},
    {"Cyan", 0x22D3EEu, 0xCFFAFEu, 0x0E7490u, 0x07A3C3u, 0xF7FEFFu, 0x00AACBu},
    {"Blue", 0x60A5FAu, 0xDBEAFEu, 0x1D4ED8u, 0x2563EBu, 0xFAFCFFu, 0x2366FCu},
    {"Turquoise", 0x2DD4BFu, 0xCCFBF1u, 0x0F766Eu, 0x10A697u, 0xF4FFFDu, 0x00AD9Du},
    {"Green", 0x4ADE80u, 0xDCFCE7u, 0x15803Du, 0x1CB454u, 0xF6FFF8u, 0x00BC54u},
    {"Rose", 0xFC7274u, 0xFFE4E3u, 0xBF1624u, 0xE2222Cu, 0xFFFBFBu, 0xF01229u},
}};

} // namespace mp::cursor_assets
