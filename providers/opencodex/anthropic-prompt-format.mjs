// Labels text on an outgoing Anthropic request without changing message roles,
// native image blocks, tool-call identities, or the stored conversation.
function section(tag, text) {
  return `<${tag}>\n<![CDATA[${text.replaceAll(']]>', ']]]]><![CDATA[>')}]]>\n</${tag}>`;
}

export function anthropicPromptSection(tag, content) {
  if (typeof content === 'string') return section(tag, content);
  return content.map(part => part.type === 'text'
    ? { ...part, text: section(tag, part.text) }
    : part);
}
