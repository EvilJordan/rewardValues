require('dotenv').config();
process.removeAllListeners('warning'); // used to remove punycode deprecation warning until google gets its shit together and upgrades node-fetch
const fs = require('fs');
const { google } = require('googleapis');
const serviceAuth = new google.auth.GoogleAuth({
	keyFile: './.serviceCredentials.json',
	scopes: [ 'https://www.googleapis.com/auth/spreadsheets' ]
});
google.options({ auth: serviceAuth });
const sheets = google.sheets({ version: 'v4' });
const TRANSACTIONCACHEFILE = './.transactionCache.json';
const formatter = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD'
});

const getSheetsTransactions = async () => {
	let sheetsResponse;
	try {
		sheetsResponse = await sheets.spreadsheets.values.get({
			spreadsheetId: process.env.SPREADSHEETID,
			range: process.env.SPREADSHEETNAME,
			valueRenderOption: 'UNFORMATTED_VALUE',
			dateTimeRenderOption: 'FORMATTED_STRING'
		});
	} catch(e) {
		if (e.errors || e.response?.data?.error) {
			return { errors: e.errors ? e.errors : e.response?.data?.error ? e.response.data.error : 'error' };
		}
	}
	const localSheetTransactions = sheetsResponse.data.values;
	if (!localSheetTransactions || localSheetTransactions.length === 0) {
		console.log('No data found.');
		return {};
	}
	const headers = localSheetTransactions[0];
	let data = [];
	for (i = 1; i < localSheetTransactions.length; i++) { // skip header row
		let newRow = {};
		headers.forEach((header, index) => {
			if (localSheetTransactions[i][index]) {
				newRow[header] = localSheetTransactions[i][index];
				newRow['rowNum'] = i + 1;
			}
		});
		data.push(newRow);
	}

	// transform sheet transactions into UUID objects
	let sheetData = {};
	data.forEach((row) => {
		sheetData[row.UUID] = row;
	});
	return sheetData;
}

const go = async () => {
	let transactions = {};
	try {
		transactions = JSON.parse(fs.readFileSync(TRANSACTIONCACHEFILE));
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}
	// transform transactions into UUID objects
	let txData = {};
	Object.keys(transactions).forEach((thisBlock) => {
		const timestamp = Number(transactions[thisBlock].timestamp);
		const dateParts = transactions[thisBlock].date.split('-');
		const thisRationalDate = dateParts[1] + '-' + dateParts[0] + '-' + dateParts[2]; // change the date to mm-dd-yyyy
		const closingPrice = transactions[thisBlock].closingPrice;
		if (transactions[thisBlock].transactions) {
			transactions[thisBlock].transactions.forEach((tx) => {
				if (tx.taxable) { // exclude uniswap change transactions because sheets data doesn't know about swaps for tax purposes
					txData[tx.UUID] = tx;
					txData[tx.UUID].layer = 'EL';
					txData[tx.UUID].timestamp = timestamp;
					txData[tx.UUID].date = thisRationalDate;
					txData[tx.UUID].closingPrice = closingPrice;
					txData[tx.UUID].blockNumber = Number(thisBlock);
				}
			});
		}
		if (transactions[thisBlock].withdrawals) {
			transactions[thisBlock].withdrawals.forEach((withdrawal) => {
				txData[withdrawal.UUID] = withdrawal;
				txData[withdrawal.UUID].layer = 'CL';
				txData[withdrawal.UUID].timestamp = timestamp;
				txData[withdrawal.UUID].date = thisRationalDate;
				txData[withdrawal.UUID].closingPrice = closingPrice;
				txData[withdrawal.UUID].blockNumber = Number(thisBlock);
			});
		}
	});
	transactions = txData;
	txData = null;

	const sheetTransactions = await getSheetsTransactions();
	if (sheetTransactions.errors) {
		console.log(sheetTransactions);
		return;
	}

	let operations = { updateSheetUUIDs: [], appendSheetUUIDS: [], updates: [], appends: [] };
	Object.keys(transactions).forEach((UUID) => {
		if (!sheetTransactions[UUID]) {
			operations.appendSheetUUIDS.push(UUID);
		} else if (transactions[UUID].closingPrice > 0 && (!sheetTransactions[UUID]['USD Closing Price'] || sheetTransactions[UUID]['USD Closing Price'] === 0)) {
			operations.updateSheetUUIDs.push(UUID);
		}
	});

	if (operations.updateSheetUUIDs.length > 0) {
		console.log('Updating', operations.updateSheetUUIDs.length, 'rows...');
		let updateUSDTotal = 0;
		operations.updateSheetUUIDs.forEach((UUID) => {
			// console.log('update (' + sheetTransactions[UUID].rowNum + '):', sheetTransactions[UUID], transactions[UUID]);
			operations.updates.push({
				majorDimension: 'ROWS',
				range: process.env.SPREADSHEETNAME + '!C' + sheetTransactions[UUID].rowNum + ':D' + sheetTransactions[UUID].rowNum,
				values: [[transactions[UUID].closingPrice, transactions[UUID].usdValue]]
			});
			updateUSDTotal += transactions[UUID].usdValue;
		});
		try {
			sheetsResponse = await sheets.spreadsheets.values.batchUpdate({
				spreadsheetId: process.env.SPREADSHEETID,
				requestBody: {
					valueInputOption: 'USER_ENTERED',
					data: operations.updates,
				},
			});
		} catch(e) {
			console.log(e.errors);
			return;
		}
		console.log('Updated', sheetsResponse.data.totalUpdatedRows, 'rows:', '\x1b[32m' + formatter.format(updateUSDTotal) + '\x1b[0m');
	}
	if (operations.appendSheetUUIDS.length > 0) {
		console.log('Appending', operations.appendSheetUUIDS.length, 'rows...');
		let appendUSDTotal = 0;
		let appendETHTotal = 0;
		operations.appendSheetUUIDS.forEach((UUID) => {
			// console.log('append:', transactions[UUID]);
			operations.appends.push(
				[transactions[UUID].date, transactions[UUID].layer, transactions[UUID].closingPrice, transactions[UUID].usdValue, transactions[UUID].ethValue, transactions[UUID].blockNumber, transactions[UUID].hash ? transactions[UUID].hash : '', UUID]
			);
			appendUSDTotal += transactions[UUID].usdValue;
			appendETHTotal += transactions[UUID].ethValue;
		});
		try {
			sheetsResponse = await sheets.spreadsheets.values.append({
				spreadsheetId: process.env.SPREADSHEETID,
				range: process.env.SPREADSHEETNAME,
				valueInputOption: 'USER_ENTERED',
				resource: {
					majorDimension: 'ROWS',
					values: operations.appends
				}
			});
		} catch(e) {
			console.log(e);
			return;
		}
		console.log('Appended', sheetsResponse.data.updates.updatedRows, 'rows:', '\x1b[32m' + formatter.format(appendUSDTotal) + '\x1b[0m', '\x1b[33m' + appendETHTotal + '\x1b[0m');
	}
}

go();
