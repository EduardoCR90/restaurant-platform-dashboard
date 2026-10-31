// Solo para comprobar localmente el código de Edge con tsc. CI usa además deno check real.
declare namespace Deno {
  const env: { get(name: string): string | undefined };
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
