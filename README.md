# Ethereum Reward Values (Execution and Consensus)

Simple nodeJS script to connect to Etherscan ([using a free API key](https://docs.etherscan.io/getting-started/creating-an-account)) to pull incoming transactions, mined blocks and Consensus Layer withdrawal rewards, correlate with the closing day USD price of ETH (from Coingecko's API, [using a free DEMO API key](https://support.coingecko.com/hc/en-us/articles/21880397454233-User-Guide-How-to-sign-up-for-CoinGecko-Demo-API-and-generate-an-API-key)), and create a report (CSV) for tax purposes.

Now including _optional_ Google Sheets connectivity!

Now NOW including _optional_ First In, First Out captial gains and cost-basis accounting!

This script assumes **all** incoming transactions are Execution Layer proposal rewards and purposefully _excludes_ Uniswap Routers from any incoming internal transaction data.

## Install, Setup, and Running

1. run `npm install`
2. Create a `.env` file and add:
```attributes
ADDRESS=0X_ETHEREUM_ADDRESS
ETHERSCANAPIKEY=YOUR_ETHERSCAN_API_KEY
COINGECKOAPIKEY=YOUR_COINGECKO_API_KEY
SPREADSHEETID=GOOGLE_SHEETS_SPREADSHEET_ID # optional
SPREADSHEETNAME=GOOGLE_SHEETS_SPREADSHEET_NAME # optional
```
3. `node getRewards`
---
It is also possible to pass a `startDate` and `endDate` at the command line to limit the range of the output data. Dates must be formed like `mm-dd-yyyy`. Omitting the `endDate` will output from `startDate` until `now`. Omitting both outputs everything.

For Consensus Layer withdrawal rewards, a `startBlock` and `endBlock` **may** be specified.

Use the command `node getRewards --help` for detailed usage instructions.

If progress seems to stop, it's because the code is backing off the APIs for a moment as the free and demo tiers have rate limits. Don't panic.

Examples:
```console
# get everything - note, you may need to run this multiple times if there are more than 10,000 transactions or withdrawals
node getRewards

# get all EL rewards from 4/13/2023 - 4/15/2023 and all CL withdrawals in blocks 17034893 through 17034895
node getRewards --startDate 04-13-2023 --endDate 04-15-2023 --startBlock 17034893 --endBlock 17034895

# get all EL ever for an address and all CL withdrawals in blocks 17034893 through 17034895
node getRewards -b 17034893 -c 17034895
```
---

## Trust Assumptions
This tool was created with a focus of not relying on a centralized database or complex setup. That said, it works with both Etherscan and CoinGecko (centralized databases). One has to make a leap of faith that both of these are good actors in the space.

Etherscan's APIs are used to pull in transaction data, withdrawals (aka CL rewards) and "internal" transaction data for EL block rewards, and convert a given block ID to a timestamp.

---

## TODO:
- Accept multiple addresses
- Specify fiat currency (from available Coingecko currencies)
- User-specified output file
- Add sum-by-date output option (this now exists in FIFO, but is not exposed externally)
- Documentation on _optional_ Google Sheets connector
- Documentation on _optional_ FIFO cost-basis and short/long-term capital gains

### _Disclaimer: I am not a tax professional, I know very, very little about anything at all, and I have no idea if the output report would be sufficient for any accountant or tax authority. I built this to help me calculate my own taxes and stay on top of things._
