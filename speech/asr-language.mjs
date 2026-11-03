// Omitting language_hints enables Paraformer's automatic language detection.
// Do not send the literal value "auto" as an upstream language code.
export function aliyunLanguageParameters(language) {
  return language === 'auto' ? {} : { language_hints: [language || 'zh'] };
}
