export function shouldSubmitChatOnEnter(key: string, shiftKey: boolean, isComposing: boolean) {
  return key === "Enter" && !shiftKey && !isComposing;
}
