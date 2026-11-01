/**
 * Ambient type declarations for CSS and style modules.
 * Resolves TypeScript "Cannot find module '*.css'" red lines in VS Code.
 */

declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
