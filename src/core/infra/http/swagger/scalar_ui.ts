export function scalarUiHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>StayHub API Docs (Scalar POC)</title>
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="${specUrl}"
      data-configuration='{"theme":"purple","persistAuth":true}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}
