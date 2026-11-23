/**
 * Windows: family names, as the app's package declares its font files to Windows (Package.appxmanifest,
 * windows.sharedFonts). Each weight of Inter is its own family there (the files were renamed so), since the styles
 * give a font family and no weight. Kept under 32 characters: React Native Windows copies the name of a text
 * field's font into a 32-character buffer and closes the app when it is longer.
 */
export const fonts = {
  display: 'Anton',
  regular: 'Inter',
  medium: 'Inter Medium',
  semibold: 'Inter SemiBold',
  bold: 'Inter Bold',
  heavy: 'Inter ExtraBold',
} as const;
