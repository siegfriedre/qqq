var Backtest = (function () {
    'use strict';

    function calcRSI(closes, period) {
        var result = [];
        var gains = 0, losses = 0;
        for (var i = 1; i < closes.length; i++) {
            var change = closes[i] - closes[i - 1];
            var gain = change > 0 ? change : 0;
            var loss = change < 0 ? -change : 0;
            if (i < period) {
                gains += gain; losses += loss;
                result.push(null);
            } else if (i === period) {
                gains += gain; losses += loss;
                var avgGain = gains / period, avgLoss = losses / period;
                var rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                result.push(100 - (100 / (1 + rs)));
                gains = avgGain; losses = avgLoss;
            } else {
                gains = (gains * (period - 1) + gain) / period;
                losses = (losses * (period - 1) + loss) / period;
                var rs = losses === 0 ? 100 : gains / losses;
                result.push(100 - (100 / (1 + rs)));
            }
        }
        result.unshift(null);
        return result;
    }

    function calcMA(closes, period) {
        var result = [];
        for (var i = 0; i < closes.length; i++) {
            if (i < period - 1) { result.push(null); continue; }
            var sum = 0;
            for (var j = i - period + 1; j <= i; j++) sum += closes[j];
            result.push(sum / period);
        }
        return result;
    }

    function parseData(rawResult) {
        var ts = rawResult.timestamp || [];
        var quote = rawResult.indicators.quote[0];
        var dates = [], opens = [], highs = [], lows = [], closes = [], volumes = [];
        for (var i = 0; i < ts.length; i++) {
            if (quote.open[i] == null || quote.close[i] == null) continue;
            dates.push(ts[i] * 1000);
            opens.push(quote.open[i]);
            highs.push(quote.high[i] || quote.close[i]);
            lows.push(quote.low[i] || quote.close[i]);
            closes.push(quote.close[i]);
            volumes.push(quote.volume[i] || 0);
        }
        return { dates: dates, opens: opens, highs: highs, lows: lows, closes: closes, volumes: volumes };
    }

    function toDateStr(ts) {
        var d = new Date(ts);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function getMonday(ts) {
        var d = new Date(ts);
        var day = d.getDay();
        d.setDate(d.getDate() - ((day + 6) % 7));
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function getMonthKey(ts) {
        var d = new Date(ts);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    function getYearKey(ts) {
        return String(new Date(ts).getFullYear());
    }

    function runSingle(stockData, config) {
        var cfg = config;
        var startDate = new Date(cfg.startDate).getTime();
        var endDate = new Date(cfg.endDate).getTime();

        var d = parseData(stockData);
        if (!d.dates.length) return null;

        var filtered = { dates: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
        for (var i = 0; i < d.dates.length; i++) {
            if (d.dates[i] >= startDate && d.dates[i] <= endDate) {
                filtered.dates.push(d.dates[i]);
                filtered.opens.push(d.opens[i]);
                filtered.highs.push(d.highs[i]);
                filtered.lows.push(d.lows[i]);
                filtered.closes.push(d.closes[i]);
                filtered.volumes.push(d.volumes[i]);
            }
        }
        if (!filtered.dates.length) return null;

        var rsi6 = calcRSI(filtered.closes, 6);
        var ma5 = calcMA(filtered.closes, 5);
        var ma10 = calcMA(filtered.closes, 10);
        var ma20 = calcMA(filtered.closes, 20);
        var ma60 = calcMA(filtered.closes, 60);
        var ma120 = calcMA(filtered.closes, 120);
        var ma200 = calcMA(filtered.closes, 200);

        var maMap = { 5: ma5, 10: ma10, 20: ma20, 60: ma60, 120: ma120, 200: ma200 };

        var shares = 0;
        var cashInvested = { dca: 0, rsi: 0, ma_buy: 0, ma_sell_proceeds: 0, rsi_sell_rebuy: 0, ma_sell_rebuy: 0 };
        var transactions = [];
        var lastDcaKey = null;

        var maRebuyPool = 0;
        var rsiRebuyPool = 0;

        for (var i = 0; i < filtered.dates.length; i++) {
            var ts = filtered.dates[i];
            var price = filtered.closes[i];

            if (cfg.method === 'dca' && cfg.dcaAmount > 0) {
                var key;
                if (cfg.dcaPeriod === 'weekly') key = getMonday(ts);
                else if (cfg.dcaPeriod === 'monthly') key = getMonthKey(ts);
                else if (cfg.dcaPeriod === 'yearly') key = getYearKey(ts);
                else key = getMonthKey(ts);

                if (key !== lastDcaKey) {
                    lastDcaKey = key;
                    var skip = false;
                    if (cfg.rsiPause && cfg.rsiPause.enabled && rsi6[i] != null && rsi6[i] > cfg.rsiPause.threshold) {
                        skip = true;
                    }
                    if (!skip) {
                        var dcaShares = cfg.dcaAmount / price;
                        shares += dcaShares;
                        cashInvested.dca += cfg.dcaAmount;
                        transactions.push({ date: toDateStr(ts), type: 'dca', price: price, shares: dcaShares, amount: cfg.dcaAmount, cashFlow: -cfg.dcaAmount });
                    }
                }
            }

            if (cfg.rsiAdd && cfg.rsiAdd.enabled && rsi6[i] != null && rsi6[i] < cfg.rsiAdd.threshold) {
                var addShares = cfg.rsiAdd.amount / price;
                shares += addShares;
                cashInvested.rsi += cfg.rsiAdd.amount;
                transactions.push({ date: toDateStr(ts), type: 'rsi_buy', price: price, shares: addShares, amount: cfg.rsiAdd.amount, cashFlow: -cfg.rsiAdd.amount });
            }

            if (cfg.rsiSell && cfg.rsiSell.enabled && cfg.rsiSell.percent > 0 && rsi6[i] != null && rsi6[i] > cfg.rsiSell.threshold && shares > 0) {
                var rsiSellShares = shares * (cfg.rsiSell.percent / 100);
                if (rsiSellShares > 0.0001) {
                    var rsiSellAmount = rsiSellShares * price;
                    shares -= rsiSellShares;
                    cashInvested.rsi_sell_rebuy += rsiSellAmount;
                    rsiRebuyPool += rsiSellAmount;
                    transactions.push({ date: toDateStr(ts), type: 'rsi_sell', price: price, shares: rsiSellShares, amount: rsiSellAmount, cashFlow: +rsiSellAmount });
                }
            }

            if (cfg.rsiSell && cfg.rsiSell.rebuy && rsiRebuyPool > 0 && rsi6[i] != null && rsi6[i] < cfg.rsiSell.threshold) {
                var rsiRebuyShares = rsiRebuyPool / price;
                shares += rsiRebuyShares;
                cashInvested.rsi_sell_rebuy -= rsiRebuyPool;
                transactions.push({ date: toDateStr(ts), type: 'rsi_rebuy', price: price, shares: rsiRebuyShares, amount: rsiRebuyPool, cashFlow: -rsiRebuyPool });
                rsiRebuyPool = 0;
            }

            if (cfg.maAdd && cfg.maAdd.enabled && i > 0) {
                var maA = maMap[cfg.maAdd.period];
                if (maA && maA[i] != null && maA[i - 1] != null) {
                    if (filtered.closes[i - 1] <= maA[i - 1] && filtered.closes[i] > maA[i]) {
                        var maAddShares = cfg.maAdd.amount / price;
                        shares += maAddShares;
                        cashInvested.ma_buy += cfg.maAdd.amount;
                        transactions.push({ date: toDateStr(ts), type: 'ma_buy', price: price, shares: maAddShares, amount: cfg.maAdd.amount, cashFlow: -cfg.maAdd.amount });
                    }
                }
            }

            if (cfg.maSell && cfg.maSell.enabled && i > 0) {
                var maS = maMap[cfg.maSell.period];
                if (maS && maS[i] != null && maS[i - 1] != null) {
                    if (cfg.maSell.enabled && cfg.maSell.percent > 0 && filtered.closes[i - 1] >= maS[i - 1] && filtered.closes[i] < maS[i] && shares > 0) {
                        var sellShares = shares * (cfg.maSell.percent / 100);
                        if (sellShares > 0.0001) {
                            var sellAmount = sellShares * price;
                            shares -= sellShares;
                            cashInvested.ma_sell_rebuy += sellAmount;
                            maRebuyPool += sellAmount;
                            transactions.push({ date: toDateStr(ts), type: 'ma_sell', price: price, shares: sellShares, amount: sellAmount, cashFlow: +sellAmount });
                        }
                    }
                    if (cfg.maSell.rebuy && maRebuyPool > 0 && filtered.closes[i - 1] <= maS[i - 1] && filtered.closes[i] > maS[i]) {
                        var rebuyShares = maRebuyPool / price;
                        shares += rebuyShares;
                        cashInvested.ma_sell_rebuy -= maRebuyPool;
                        transactions.push({ date: toDateStr(ts), type: 'ma_rebuy', price: price, shares: rebuyShares, amount: maRebuyPool, cashFlow: -maRebuyPool });
                        maRebuyPool = 0;
                    }
                }
            }
        }

        var lastPrice = filtered.closes[filtered.closes.length - 1];
        var currentValue = shares * lastPrice + rsiRebuyPool + maRebuyPool;
        var totalInvested = cashInvested.dca + cashInvested.rsi + cashInvested.ma_buy;
        var netInvested = totalInvested;
        var totalReturn = currentValue - netInvested;
        var totalReturnPct = netInvested > 0 ? (totalReturn / netInvested * 100) : 0;

        var dcaReturn = cashInvested.dca > 0 ? ((currentValue * (cashInvested.dca / totalInvested)) - cashInvested.dca) : 0;
        var rsiReturn = cashInvested.rsi > 0 ? ((currentValue * (cashInvested.rsi / totalInvested)) - cashInvested.rsi) : 0;
        var maBuyReturn = cashInvested.ma_buy > 0 ? ((currentValue * (cashInvested.ma_buy / totalInvested)) - cashInvested.ma_buy) : 0;

        var annualMap = {};
        for (var j = 0; j < transactions.length; j++) {
            var y = transactions[j].date.substring(0, 4);
            if (!annualMap[y]) annualMap[y] = { dca: 0, rsi: 0, ma_buy: 0, ma_sell: 0, rsi_sell: 0, rsi_rebuy: 0, ma_rebuy: 0, dcaIn: 0, rsiIn: 0, maIn: 0, maOut: 0, rsiOut: 0, maRIn: 0, rsiRIn: 0 };
            if (transactions[j].type === 'dca') { annualMap[y].dca++; annualMap[y].dcaIn += transactions[j].amount; }
            if (transactions[j].type === 'rsi_buy') { annualMap[y].rsi++; annualMap[y].rsiIn += transactions[j].amount; }
            if (transactions[j].type === 'ma_buy') { annualMap[y].ma_buy++; annualMap[y].maIn += transactions[j].amount; }
            if (transactions[j].type === 'ma_sell') { annualMap[y].ma_sell++; annualMap[y].maOut += transactions[j].amount; }
            if (transactions[j].type === 'rsi_sell') { annualMap[y].rsi_sell++; annualMap[y].rsiOut += transactions[j].amount; }
            if (transactions[j].type === 'rsi_rebuy') { annualMap[y].rsi_rebuy++; annualMap[y].rsiRIn += transactions[j].amount; }
            if (transactions[j].type === 'ma_rebuy') { annualMap[y].ma_rebuy++; annualMap[y].maRIn += transactions[j].amount; }
        }
        var annuals = [];
        Object.keys(annualMap).sort().forEach(function (y) {
            var a = annualMap[y];
            a.year = y;
            annuals.push(a);
        });

        return {
            symbol: cfg.symbol,
            transactions: transactions,
            shares: shares,
            lastPrice: lastPrice,
            currentValue: currentValue,
            cashInvested: cashInvested,
            totalInvested: totalInvested,
            netInvested: netInvested,
            totalReturn: totalReturn,
            totalReturnPct: totalReturnPct,
            dcaReturn: dcaReturn,
            rsiReturn: rsiReturn,
            maBuyReturn: maBuyReturn,
            maSellProceeds: (cashInvested.ma_sell_rebuy || 0) + (cashInvested.rsi_sell_rebuy || 0),
            rebuyCash: rsiRebuyPool + maRebuyPool,
            annuals: annuals
        };
    }

    function runStrategy(strategyName, strategyStocks, stockDataCache, startDate, endDate) {
        var results = [];
        var combined = {
            totalInvested: 0, netInvested: 0, currentValue: 0, totalReturn: 0, totalReturnPct: 0,
            dcaReturn: 0, rsiReturn: 0, maBuyReturn: 0, maSellProceeds: 0, rebuyCash: 0,
            cashInvested: { dca: 0, rsi: 0, ma_buy: 0, ma_sell_rebuy: 0, rsi_sell_rebuy: 0 },
            stocks: []
        };

        strategyStocks.forEach(function (sc) {
            var rawData = stockDataCache[sc.symbol];
            if (!rawData) return;

            var cfg = {
                symbol: sc.symbol,
                method: sc.method || 'dca',
                dcaPeriod: sc.dcaPeriod || 'monthly',
                dcaAmount: sc.dcaAmount || 0,
                startDate: startDate,
                endDate: endDate,
                rsiAdd: sc.rsiAdd || null,
                rsiPause: sc.rsiPause || null,
                rsiSell: sc.rsiSell || null,
                maAdd: sc.maAdd || null,
                maSell: sc.maSell || null
            };

            var r = runSingle(rawData, cfg);
            if (!r) return;

            results.push(r);
            combined.stocks.push(r);

            combined.totalInvested += r.totalInvested;
            combined.netInvested += r.netInvested;
            combined.currentValue += r.currentValue;
            combined.totalReturn += r.totalReturn;
            combined.cashInvested.dca += r.cashInvested.dca;
            combined.cashInvested.rsi += r.cashInvested.rsi;
            combined.cashInvested.ma_buy += r.cashInvested.ma_buy;
            combined.cashInvested.ma_sell_rebuy += r.cashInvested.ma_sell_rebuy;
            combined.cashInvested.rsi_sell_rebuy += r.cashInvested.rsi_sell_rebuy;
            combined.rebuyCash = (combined.rebuyCash || 0) + (r.rebuyCash || 0);
            combined.dcaReturn += r.dcaReturn;
            combined.rsiReturn += r.rsiReturn;
            combined.maBuyReturn += r.maBuyReturn;
            combined.maSellProceeds += r.maSellProceeds;
        });

        combined.totalReturnPct = combined.netInvested > 0 ? (combined.totalReturn / combined.netInvested * 100) : 0;

        var mergedAnnuals = {};
        results.forEach(function (r) {
            r.annuals.forEach(function (a) {
                if (!mergedAnnuals[a.year]) mergedAnnuals[a.year] = { year: a.year, dca: 0, rsi: 0, ma_buy: 0, ma_sell: 0, rsi_sell: 0, rsi_rebuy: 0, ma_rebuy: 0, dcaIn: 0, rsiIn: 0, maIn: 0, maOut: 0, rsiOut: 0, maRIn: 0, rsiRIn: 0 };
                mergedAnnuals[a.year].dca += a.dca;
                mergedAnnuals[a.year].rsi += a.rsi;
                mergedAnnuals[a.year].ma_buy += a.ma_buy;
                mergedAnnuals[a.year].ma_sell += a.ma_sell;
                mergedAnnuals[a.year].rsi_sell += a.rsi_sell;
                mergedAnnuals[a.year].rsi_rebuy += a.rsi_rebuy;
                mergedAnnuals[a.year].ma_rebuy += a.ma_rebuy;
                mergedAnnuals[a.year].dcaIn += a.dcaIn;
                mergedAnnuals[a.year].rsiIn += a.rsiIn;
                mergedAnnuals[a.year].maIn += a.maIn;
                mergedAnnuals[a.year].maOut += a.maOut;
            });
        });

        return {
            name: strategyName,
            combined: combined,
            stocks: results,
            annuals: Object.keys(mergedAnnuals).sort().map(function (y) { return mergedAnnuals[y]; })
        };
    }

    return {
        runStrategy: runStrategy,
        runSingle: runSingle
    };
})();
