# Solana Json Codec

Generate JSON codecs for solana IDL's types.

## Examples

```sh
# Account state JSON codec module for a SPL token mint account
npx solana-json-codec --program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA account-state TokenMint
# Instruction params JSON codec module for a SPL token transfer instruction
npx solana-json-codec --program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA instruction-payload Transfer
```
