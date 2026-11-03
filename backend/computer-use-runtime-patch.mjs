// Windows GetWindowRect may be DPI-virtualized while DWM frame bounds are not.
// Keep the application's own AUV daemon, runners and CLI in one coordinate
// space. This is a child-process compatibility flag, not an OS registry setting.
export function patchComputerUseRuntime(code, platform = process.platform) {
  if (platform !== 'win32') return code;
  const replacements = [
    ['      noRegister: true,', "      noRegister: true,\n      environment: { __COMPAT_LAYER: 'HIGHDPIAWARE' },"],
    ['env: { ...process.env, AUV_ENDPOINT:', "env: { ...process.env, __COMPAT_LAYER: 'HIGHDPIAWARE', AUV_ENDPOINT:"],
  ];
  for (const [before, after] of replacements) {
    if (code.split(before).length !== 2) throw new Error('Pinned LINGBO computer-use runtime changed; DPI patch was not applied.');
    code = code.replace(before, after);
  }
  return code;
}

export function patchComputerUseTools(code, platform = process.platform) {
  if (platform !== 'win32') return code;
  const needle = "This tool acts on the local computer.'";
  if (code.split(needle).length !== 2) throw new Error('Pinned LINGBO computer-use tool description changed.');
  const guidance = ' Windows CLI values are positional: ["invoke","input.key","ctrl+h"], ["invoke","input.typeText","text"], ["invoke","input.clickPoint","200","100","--target","window:ID","--relative-to","window","--input-policy","foreground-preferred"]. Do not invent --key, --text, --x or --y. Inspect command help when uncertain. Windows keyboard input does not support --target: first establish focus in the intended window and control. For Qt/WPS clicks use foreground-preferred and verify the UI effect. A window capture shows that window only, not its separate dialogs: after opening a dialog, use window.list to locate its window id/title and capture the dialog separately. Dialog field clicks must target that dialog window id with dialog-relative coordinates, never the parent window id. Capturing a window does not establish keyboard focus. Never infer an action failed solely because the parent screenshot did not change. Use capture bounds and pixel dimensions to map points; do not mix desktop, window and image coordinate spaces. If a window moved or changed size, observe it again before using coordinates. For exact Unicode text consider input.pasteText after inspecting its help; do not infer fullwidth versus halfwidth code points from glyph appearance alone. Exit code 0 and verified=false only prove delivery; confirm edits from UI and saved output before reporting completion.';
  const wpsGuidance = ' In WPS find/replace, first select and replace the complete field value; never append another literal merely because the match count is still zero. Press Enter from the find field to execute a search before judging its count. Use ordinary Find Next or Replace All, not similarly named AI search buttons. Replacement confirmations are separate dialogs; observe and dismiss the exact confirmation before continuing. Preserve unexpected output differences and report them instead of silently relaxing the requested acceptance.';
  return code.replace(needle, "This tool acts on the local computer." + guidance + wpsGuidance + "'");
}
