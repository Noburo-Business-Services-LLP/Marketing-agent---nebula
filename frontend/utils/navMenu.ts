/** Is the current page inside this group of menu items? Used to keep the folded group open on its own pages. */
export function groupHasPath(pathname: string, paths: string[]): boolean {
  return paths.some((p) => pathname === p || (p !== '/dashboard' && pathname.startsWith(`${p}/`)) || pathname.startsWith(`${p}?`));
}
