# Ethereum Reward Values

Simple nodeJS script to connect to Etherscan ([using a free API key](https://docs.etherscan.io/getting-started/creating-an-account)) to pull incoming transactions and mined blocks, correlate with the closing day USD price of ETH (from Coingecko's API), and create a report (CSV) for tax purposes.

This script assumes **all** incoming transactions are proposal awards.

## Install, Setup, and Running

1. run `npm install`
2. Create a `.env` file and add:
```attributes
ADDRESS=0X_ETHEREUM_ADDRESS
ETHERSCANAPIKEY=YOUR_ETHERSCAN_API_KEY
```
3. `node rewardValues.js`
---
It is also possible to pass a `startDate` and `endDate` at the command line to limit the range of the output data. Dates must be formed like `mm-dd-yyyy`. Omitting the `endDate` will output from `startDate` until `now`. Omitting both outputs everything.

Example:
```console
node rewardValues.js 01-13-2022 02-13-2022 
```
---
## TODO:
- Accept multiple addresses
- Specify fiat currency (from available Coingecko currencies)
- Formal command line options with arg or yarg
- User-specified output file
