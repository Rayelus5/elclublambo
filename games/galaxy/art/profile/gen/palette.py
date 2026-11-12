"""The profile art's colours: the game's palette (apps/web/src/arena/sprites/palette.ts, DESIGN_SYSTEM §2.1 tokens) and
the ramps built on it, light to dark, with the extra hue-shifted shades the shading needs. The metal ramps are the
season tiers' (art/seasons/paint-tiers.lua), so a gold frame and a gold emblem are the same gold."""

# The arena palette, by its letters.
P = {
    'k': '#0b0c24', 'w': '#f3f5ff', 'i': '#bfe3ff', 'b': '#6fb7ff', 'd': '#3a58e0', 'D': '#26389a', 'c': '#6fe3ff',
    's': '#ffc94a', 'o': '#ff9a3c', 'r': '#c25f1c', 'm': '#ff4d6d', 'n': '#ff6b7a', 'e': '#e8435a', 'x': '#9c2238',
    'z': '#4a0f22', 'U': '#b39dff', 'u': '#7259ee', 'a': '#5a43d6', 'p': '#3a2a9a', 'g': '#45e3a6', 'G': '#17b07e',
    'h': '#0b7352', 'y': '#8890c4', 'Y': '#b9bfe6', 't': '#2a2f5e', 'T': '#4b5390', 'q': '#ff8fb3', 'Q': '#c94f7c',
    'j': '#3fe0d0', 'J': '#13867f', 'l': '#ff5a1f', 'L': '#5a1d10', 'v': '#e05cff', 'V': '#8e2bb3',
}

INK = P['k']
VOID = '#070a1c'
PANEL = '#181a3d'
PANEL2 = '#20234f'
WHITE = '#ffffff'

# Metals (season tiers) ----------------------------------------------------------------------------------------------
BRONZE = ['#ffd9ae', '#e8a35f', '#c2732f', '#8f4a1e', '#5a2a10', '#1e0c04']
SILVER = ['#ffffff', '#d6dbef', '#a3a9c6', '#6a7090', '#3b4060', '#11131f']
GOLD = ['#fffbe6', '#ffe58a', '#ffc94a', '#e0962a', '#c27a12', '#7a3d08', '#2a1203']
PLATINUM = ['#f6feff', '#bff3ff', '#6fd0e8', '#2f7f9e', '#1a4a66', '#06141f']
STEEL = ['#e6e9f8', '#b9bfe6', '#8890c4', '#4b5390', '#2a2f5e', '#161935']
IRON = ['#8a8fb8', '#5d628f', '#3d4170', '#262a4f', '#161833', '#0b0c1e']

# Game hues as ramps -------------------------------------------------------------------------------------------------
UV = ['#f3efff', '#b39dff', '#9b86ff', '#7259ee', '#5a43d6', '#3a2a9a', '#22185e', '#130c36']
SKY = ['#e9f1ff', '#bfe3ff', '#6fb7ff', '#4767f2', '#3a58e0', '#26389a', '#17225e']
ICE = ['#ffffff', '#e6f6ff', '#bfe3ff', '#8fcaf5', '#6fb7ff', '#3a7fc8', '#1d3f7a']
CYAN = ['#f3feff', '#b8f6ff', '#6fe3ff', '#2fb8e0', '#1a7fa8', '#0e4a6e']
TERM = ['#e4fff4', '#9df5d0', '#45e3a6', '#17b07e', '#0b7352', '#04281c']
TEAL = ['#cffff8', '#7ff0e4', '#3fe0d0', '#22b3a8', '#13867f', '#0a4f4c']
SOLAR = ['#fffbe6', '#ffe58a', '#ffc94a', '#ff9a3c', '#c25f1c', '#7a3510', '#3a1700']
NOVA = ['#ffe3e7', '#ffb0b9', '#ff6b7a', '#e8435a', '#9c2238', '#4a0f22']
CORAL = ['#ffe4ee', '#ffb8d0', '#ff8fb3', '#e06c97', '#c94f7c', '#7a2a50', '#3e1029']
GLITCH = ['#fbe4ff', '#f0a6ff', '#e05cff', '#b73fe0', '#8e2bb3', '#541a6e', '#2a0d3a']
LAVA = ['#fffbe6', '#ffe58a', '#ffc94a', '#ff9a3c', '#ff5a1f', '#c2300f', '#5a1d10', '#2a0c06']
NIGHT = ['#4b5390', '#2a2f5e', '#20234f', '#181a3d', '#11132e', '#0b0c24', '#070a1c']

# People -------------------------------------------------------------------------------------------------------------
# Skin ramps, light to dark, five tones each (highlight, base, shade, deep, line), warm and hue-shifted.
SKIN = {
    'porcelain': ['#fff0e6', '#ffd8c2', '#f0b49a', '#c98272', '#8a4a4a'],
    'light': ['#ffe3cc', '#f6c4a0', '#dd9a76', '#b36a54', '#6e3a36'],
    'olive': ['#f6d4ac', '#dcae80', '#bc8a5e', '#8e5e40', '#553226'],
    'tan': ['#f0bf8e', '#d39a68', '#b07548', '#814e30', '#4a2a1c'],
    'brown': ['#d89a6a', '#b27448', '#8e5534', '#663824', '#3a1c14'],
    'deep': ['#a86a48', '#7f4a30', '#5f3522', '#432316', '#22100a'],
    # Xeno skins.
    'green': ['#c8ffb8', '#86e58c', '#4fbf72', '#2b8a5a', '#11483a'],
    'violet': ['#f0d6ff', '#c99bff', '#9b6ae8', '#6c43b8', '#3a2070'],
    # Synthetic.
    'plating': ['#ffffff', '#e6ebfa', '#b9c1e3', '#7f88bd', '#454c82'],
}

HAIR = {
    'black': ['#5a5a86', '#36365e', '#22223f', '#141428'],
    'brown': ['#a8724a', '#7c4e30', '#55321e', '#331c10'],
    'auburn': ['#ffb070', '#e8743a', '#b84a22', '#7a2a14'],
    'blond': ['#fff2b0', '#f2cf6a', '#c99a3a', '#8a6020'],
    'white': ['#ffffff', '#dfe3f5', '#a9b0d4', '#6c739e'],
    'lilac': ['#f0e0ff', '#c7a4ff', '#9670e8', '#5e3fb0'],
    'teal': ['#c8fff4', '#5fe8d2', '#1fae9c', '#0d6a62'],
}

LIPS = {'porcelain': '#d96f7a', 'light': '#c9616a', 'olive': '#b85a58', 'tan': '#a8524a', 'brown': '#7f3a34',
        'deep': '#5a2622'}
