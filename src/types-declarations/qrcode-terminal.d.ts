declare module "qrcode-terminal" {
  function generate(
    text: string,
    options?: { small?: boolean },
    callback?: (qrString: string) => void
  ): void;
  export default { generate };
}
