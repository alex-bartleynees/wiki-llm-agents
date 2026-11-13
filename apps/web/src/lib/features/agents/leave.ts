import { afterNavigate, goto } from "$app/navigation";

/**
 * How an editor page goes back: to where it was opened from in the app, or to the
 * app's start when it was opened directly (a link, a reload). Call while the page
 * component initialises.
 */
export const editorExit = () => {
  let fromApp: boolean | undefined;
  afterNavigate(({ type }) => {
    fromApp ??= type !== "enter";
  });
  return () => {
    if (fromApp) history.back();
    else void goto("/");
  };
};
