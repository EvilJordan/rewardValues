# Ethereum Reward Values

Simple nodeJS script to connect to Etherscan (using a free API key) to pull incoming transactions and mined blocks, correlate with the closing day USD price of ETH, and create a report for tax purposes.

```
.env - Environment variables to hold target Ethereum address and Etherscan API key
rewardValues.js - main script
transactionCache.json - JSON output of collected data for faster subsequent runs
transactions.csv - CSV report, ordered by transaction date
```

## Install, Setup, and Running

1. run `npm install`
2. Create a `.env` file and add:
```attributes
ADDRESS=0X_ETHEREUM_ADDRESS
ETHERSCANAPIKEY=YOUR_ETHERSCAN_API_KEY
```
3. `npm rewardValue.js`