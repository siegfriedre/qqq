(function () {
    'use strict';

    const SYMBOLS = ['QQQ', 'TQQQ', 'SMH', 'VGT'];
    const CACHE_KEY = 'stock_data_cache';
    const CACHE_EXPIRY = 4 * 60 * 60 * 1000;
    const CHART_THEME = {
        textStyle: { color: '#6b7d95' },
        backgroundColor: 'transparent'
    };

    let stockData = {};
    let activeSymbol = 'QQQ';
    let activeInterval = '1d';
    let dataRange = 'max';
    let mainChart;

    const dom = {
        cards: document.getElementById('stockCards'),
        mainChart: document.getElementById('mainChart'),
        chartTitle: document.getElementById('chartTitle'),
        intervalSelector: document.getElementById('intervalSelector'),
        clock: document.getElementById('clock'),
        stats: {
            open: document.getElementById('stat-open'),
            prev: document.getElementById('stat-prev'),
            high: document.getElementById('stat-high'),
            low: document.getElementById('stat-low'),
            high52: document.getElementById('stat-52h'),
            low52: document.getElementById('stat-52l'),
            vol: document.getElementById('stat-vol'),
            sma200: document.getElementById('stat-sma200'),
            drawdown: document.getElementById('stat-drawdown'),
            maxgain: document.getElementById('stat-maxgain')
        }
    };

    function initCharts() {
        mainChart = echarts.init(dom.mainChart, null, {
            devicePixelRatio: window.devicePixelRatio || 1
        });

        window.addEventListener('resize', () => {
            mainChart.resize();
        });
    }

    function formatPrice(price) {
        if (price == null) return '--';
        return Number(price).toFixed(2);
    }

    function formatChange(current, previous) {
        if (current == null || previous == null || previous === 0) return { text: '--', cls: '' };
        const change = current - previous;
        const pct = (change / previous) * 100;
        const sign = change >= 0 ? '+' : '';
        return {
            text: sign + change.toFixed(2) + ' (' + sign + pct.toFixed(2) + '%)',
            cls: change >= 0 ? 'up' : 'down'
        };
    }

    function formatVolume(vol) {
        if (vol == null) return '--';
        if (vol >= 1e9) return (vol / 1e9).toFixed(2) + 'B';
        if (vol >= 1e6) return (vol / 1e6).toFixed(2) + 'M';
        if (vol >= 1e3) return (vol / 1e3).toFixed(2) + 'K';
        return vol.toString();
    }

    const CORS_PROXY = 'https://corsproxy.io/?url=';

    async function fetchStockData(symbols, range) {
        const results = {};
        const promises = symbols.map(async (symbol) => {
            try {
                const apiUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
                    symbol + '?range=' + range + '&interval=1d';

                let resp = await fetch('data/' + symbol + '_' + range + '.json');

                if (!resp.ok) {
                    const proxyUrl = CORS_PROXY + encodeURIComponent(apiUrl);
                    resp = await fetch(proxyUrl);
                }

                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const json = await resp.json();
                const result = json.chart?.result?.[0];
                if (!result) throw new Error('No data');
                results[symbol] = result;
            } catch (e) {
                console.warn('Failed to fetch ' + symbol + ':', e.message);
                results[symbol] = null;
            }
        });
        await Promise.all(promises);
        return results;
    }

    function calcMA(data, period) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                result.push(null);
            } else {
                let sum = 0;
                for (let j = i - period + 1; j <= i; j++) {
                    sum += data[j];
                }
                result.push(sum / period);
            }
        }
        return result;
    }

    function calcRSI(closes, period) {
        var result = [];
        var gains = 0;
        var losses = 0;

        for (var i = 1; i < closes.length; i++) {
            var change = closes[i] - closes[i - 1];
            if (i <= period) {
                if (change > 0) gains += change;
                else losses += Math.abs(change);
                if (i < period) {
                    result.push(null);
                    continue;
                }
                var avgGain = gains / period;
                var avgLoss = losses / period;
                var rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                result.push(100 - (100 / (1 + rs)));
            } else {
                var avgGain2 = (gains * (period - 1) + (change > 0 ? change : 0)) / period;
                var avgLoss2 = (losses * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
                gains = avgGain2 * period;
                losses = avgLoss2 * period;
                var rs2 = avgLoss2 === 0 ? 100 : avgGain2 / avgLoss2;
                result.push(100 - (100 / (1 + rs2)));
            }
        }

        return result;
    }

    function calcMaxDrawdown(closes) {
        if (!closes || closes.length < 2) return null;
        var peak = closes[0];
        var maxDD = 0;
        for (var i = 1; i < closes.length; i++) {
            if (closes[i] > peak) {
                peak = closes[i];
            }
            var dd = (peak - closes[i]) / peak * 100;
            if (dd > maxDD) maxDD = dd;
        }
        return maxDD;
    }

    function calcMaxGain(closes) {
        if (!closes || closes.length < 2) return null;
        var trough = closes[0];
        var maxGain = 0;
        for (var i = 1; i < closes.length; i++) {
            if (closes[i] < trough) {
                trough = closes[i];
            }
            var gain = (closes[i] - trough) / trough * 100;
            if (gain > maxGain) maxGain = gain;
        }
        return maxGain;
    }

    function buildCandlestickData(result) {
        const timestamps = result.timestamp || [];
        const quote = result.indicators?.quote?.[0];
        if (!quote) return { ohlc: [], volumes: [], dates: [], closes: [] };

        const opens = quote.open || [];
        const highs = quote.high || [];
        const lows = quote.low || [];
        const closes = quote.close || [];
        const volumes = quote.volume || [];

        const ohlc = [];
        const dates = [];
        const cleanCloses = [];
        const cleanVolumes = [];

        for (let i = 0; i < timestamps.length; i++) {
            if (opens[i] == null || highs[i] == null || lows[i] == null || closes[i] == null) continue;
            const ts = timestamps[i] * 1000;
            ohlc.push({ value: [ts, opens[i], closes[i], lows[i], highs[i]] });
            dates.push(ts);
            cleanCloses.push(closes[i]);
            cleanVolumes.push(volumes[i] || 0);
        }

        return { ohlc, volumes: cleanVolumes, dates, closes: cleanCloses };
    }

    function aggregateData(data, interval) {
        if (interval === '1d') return data;

        const { ohlc, volumes, dates, closes } = data;
        const agg = [];
        const aggVols = [];
        const aggDates = [];
        const aggCloses = [];
        var group = null;

        function getKey(ts) {
            var d = new Date(ts);
            switch (interval) {
                case '1wk':
                    var day = d.getDay();
                    var monday = new Date(d);
                    monday.setDate(d.getDate() - ((day + 6) % 7));
                    return monday.getFullYear() + '-' + String(monday.getMonth() + 1).padStart(2, '0') + '-' + String(monday.getDate()).padStart(2, '0');
                case '1mo':
                    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                case '3mo':
                    var q = Math.floor(d.getMonth() / 3);
                    return d.getFullYear() + '-Q' + (q + 1);
                case '1y':
                    return String(d.getFullYear());
                default:
                    return String(d.getTime());
            }
        }

        for (var i = 0; i < dates.length; i++) {
            var key = getKey(dates[i]);
            var item = ohlc[i].value;
            if (!group || group.key !== key) {
                if (group) {
                    agg.push({ value: [group.date, group.open, group.close, group.low, group.high] });
                    aggVols.push(group.volume);
                    aggDates.push(group.date);
                    aggCloses.push(group.close);
                }
                group = {
                    key: key,
                    date: dates[i],
                    open: item[1],
                    close: item[2],
                    low: item[3],
                    high: item[4],
                    volume: volumes[i]
                };
            } else {
                group.close = item[2];
                if (item[3] < group.low) group.low = item[3];
                if (item[4] > group.high) group.high = item[4];
                group.volume += volumes[i];
            }
        }
        if (group) {
            agg.push({ value: [group.date, group.open, group.close, group.low, group.high] });
            aggVols.push(group.volume);
            aggDates.push(group.date);
            aggCloses.push(group.close);
        }

        return { ohlc: agg, volumes: aggVols, dates: aggDates, closes: aggCloses };
    }

    function renderMainChart(data) {
        if (!data || !data.dates.length) return;

        const { ohlc, volumes, dates, closes } = data;
        const ma5 = calcMA(closes, 5);
        const ma10 = calcMA(closes, 10);
        const ma20 = calcMA(closes, 20);
        const ma60 = calcMA(closes, 60);

        const ma5Data = ma5.map(function (v, i) { return v != null ? [dates[i], v] : null; }).filter(Boolean);
        const ma10Data = ma10.map(function (v, i) { return v != null ? [dates[i], v] : null; }).filter(Boolean);
        const ma20Data = ma20.map(function (v, i) { return v != null ? [dates[i], v] : null; }).filter(Boolean);
        const ma60Data = ma60.map(function (v, i) { return v != null ? [dates[i], v] : null; }).filter(Boolean);

        const sma200 = calcMA(closes, 200);
        const sma200Data = sma200.map(function (v, i) { return v != null ? [dates[i], v] : null; }).filter(Boolean);

        const GREEN_FILL = '#009966';
        const GREEN_BORDER = '#00b87a';
        const RED_BORDER = '#e83c4c';
        const RED_FILL = 'rgba(10, 16, 36, 0.55)';

        const volData = volumes.map(function (v, i) {
            var open = ohlc[i] ? ohlc[i].value[1] : 0;
            var close = ohlc[i] ? ohlc[i].value[2] : 0;
            var isUp = close >= open;
            return {
                value: [dates[i], v],
                itemStyle: {
                    color: isUp ? GREEN_FILL : RED_FILL,
                    borderColor: isUp ? GREEN_BORDER : RED_BORDER,
                    borderWidth: 1
                }
            };
        });

        var isUp = closes.length >= 2 && closes[closes.length - 1] >= closes[closes.length - 2];
        var accentColor = isUp ? GREEN_BORDER : RED_BORDER;

        var option = {
            backgroundColor: 'transparent',
            grid: [
                { left: '8%', right: '3%', top: '8%', height: '48%' },
                { left: '8%', right: '3%', top: '62%', height: '10%' },
                { left: '8%', right: '3%', top: '78%', height: '16%' }
            ],
            xAxis: [
                {
                    type: 'time',
                    gridIndex: 0,
                    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
                    axisTick: { show: false },
                    axisLabel: { color: '#6b7d95', fontSize: 10, fontFamily: 'Share Tech Mono' },
                    splitLine: { show: false }
                },
                {
                    type: 'time',
                    gridIndex: 1,
                    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
                    axisTick: { show: false },
                    axisLabel: { show: false },
                    splitLine: { show: false }
                },
                {
                    type: 'time',
                    gridIndex: 2,
                    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
                    axisTick: { show: false },
                    axisLabel: { color: '#6b7d95', fontSize: 10, fontFamily: 'Share Tech Mono' },
                    splitLine: { show: false }
                }
            ],
            yAxis: [
                {
                    type: 'value',
                    gridIndex: 0,
                    scale: true,
                    splitNumber: 5,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { color: '#6b7d95', fontSize: 10, fontFamily: 'Share Tech Mono',
                        formatter: function (val) { return val.toFixed(2); } },
                    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } }
                },
                {
                    type: 'value',
                    gridIndex: 1,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { show: false },
                    splitLine: { show: false }
                },
                {
                    type: 'value',
                    gridIndex: 2,
                    min: 0,
                    max: 100,
                    interval: 25,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { color: '#6b7d95', fontSize: 9, fontFamily: 'Share Tech Mono' },
                    splitLine: {
                        lineStyle: { color: 'rgba(255,255,255,0.04)' },
                        show: true
                    }
                }
            ],
            xAxis: [
                {
                    type: 'time',
                    gridIndex: 0,
                    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
                    axisTick: { show: false },
                    axisLabel: {
                        color: '#6b7d95',
                        fontSize: 10,
                        fontFamily: 'Share Tech Mono'
                    },
                    splitLine: { show: false }
                },
                {
                    type: 'time',
                    gridIndex: 1,
                    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
                    axisTick: { show: false },
                    axisLabel: { show: false },
                    splitLine: { show: false }
                }
            ],
            yAxis: [
                {
                    type: 'value',
                    gridIndex: 0,
                    scale: true,
                    splitNumber: 6,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                        color: '#6b7d95',
                        fontSize: 10,
                        fontFamily: 'Share Tech Mono',
                        formatter: function (val) { return val.toFixed(2); }
                    },
                    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } }
                },
                {
                    type: 'value',
                    gridIndex: 1,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { show: false },
                    splitLine: { show: false }
                }
            ],
            series: [
                {
                    name: 'K线',
                    type: 'candlestick',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: ohlc,
                    itemStyle: {
                        color: GREEN_FILL,
                        color0: RED_FILL,
                        borderColor: GREEN_BORDER,
                        borderColor0: RED_BORDER,
                        borderWidth: 1
                    },
                    emphasis: {
                        focus: 'series',
                        itemStyle: {
                            borderWidth: 2,
                            shadowBlur: 10,
                            shadowColor: accentColor
                        }
                    }
                },
                {
                    name: 'MA5',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: ma5Data,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 1, color: '#f5a623', opacity: 0.8 },
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'MA10',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: ma10Data,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 1, color: '#b347ea', opacity: 0.8 },
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'MA20',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: ma20Data,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 1, color: '#00d2ff', opacity: 0.8 },
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'MA60',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: ma60Data,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 1, color: '#ff6b6b', opacity: 0.6 },
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'SMA200',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: sma200Data,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 1.5, color: '#ffd700', opacity: 0.7 },
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'Volume',
                    type: 'bar',
                    xAxisIndex: 1,
                    yAxisIndex: 1,
                    data: volData,
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'RSI6',
                    type: 'line',
                    xAxisIndex: 2,
                    yAxisIndex: 2,
                    data: calcRSI(closes, 6).map(function (v, i) { return v != null ? [dates[i], v] : null; }).filter(Boolean),
                    symbol: 'none',
                    lineStyle: { width: 1, color: '#f5a623', opacity: 0.85 },
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'RSI12',
                    type: 'line',
                    xAxisIndex: 2,
                    yAxisIndex: 2,
                    data: calcRSI(closes, 12).map(function (v, i) { return v != null ? [dates[i], v] : null; }).filter(Boolean),
                    symbol: 'none',
                    lineStyle: { width: 1, color: '#00d2ff', opacity: 0.85 },
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'RSI24',
                    type: 'line',
                    xAxisIndex: 2,
                    yAxisIndex: 2,
                    data: calcRSI(closes, 24).map(function (v, i) { return v != null ? [dates[i], v] : null; }).filter(Boolean),
                    symbol: 'none',
                    lineStyle: { width: 1, color: '#b347ea', opacity: 0.85 },
                    emphasis: { focus: 'series' },
                    markLine: {
                        silent: true,
                        symbol: 'none',
                        lineStyle: { type: 'dashed', width: 0.5 },
                        data: [
                            { yAxis: 30, lineStyle: { color: 'rgba(0,255,136,0.3)' }, label: { show: false } },
                            { yAxis: 70, lineStyle: { color: 'rgba(255,59,92,0.3)' }, label: { show: false } }
                        ]
                    }
                }
            ],
            dataZoom: [
                {
                    type: 'inside',
                    xAxisIndex: [0, 1, 2],
                    start: 70,
                    end: 100,
                    zoomOnMouseWheel: true,
                    moveOnMouseMove: true,
                    moveOnMouseWheel: false
                },
                {
                    type: 'slider',
                    xAxisIndex: [0, 1, 2],
                    start: 70,
                    end: 100,
                    height: 22,
                    bottom: 8,
                    borderColor: 'rgba(255,255,255,0.06)',
                    fillerColor: 'rgba(0,240,255,0.06)',
                    handleStyle: { color: '#00f0ff', borderColor: '#00f0ff' },
                    textStyle: { color: '#6b7d95', fontFamily: 'Share Tech Mono', fontSize: 10 },
                    dataBackground: {
                        lineStyle: { color: 'rgba(0,240,255,0.15)' },
                        areaStyle: { color: 'rgba(0,240,255,0.04)' }
                    },
                    selectedDataBackground: {
                        lineStyle: { color: 'rgba(0,240,255,0.4)' },
                        areaStyle: { color: 'rgba(0,240,255,0.1)' }
                    }
                }
            ],
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'cross',
                    crossStyle: { color: 'rgba(255,255,255,0.1)' },
                    lineStyle: { color: 'rgba(0,240,255,0.3)', width: 1, type: 'dashed' },
                    label: {
                        backgroundColor: 'rgba(10,16,36,0.95)',
                        borderColor: 'rgba(0,240,255,0.3)',
                        borderWidth: 1,
                        color: '#fff',
                        fontFamily: 'Share Tech Mono',
                        fontSize: 11
                    }
                },
                backgroundColor: 'rgba(10,16,36,0.95)',
                borderColor: 'rgba(0,240,255,0.3)',
                borderWidth: 1,
                textStyle: {
                    color: '#c8d6e5',
                    fontFamily: 'Share Tech Mono',
                    fontSize: 11
                },
                formatter: function (params) {
                    var ts = params[0].axisValue;
                    var d = ts ? new Date(ts) : new Date();
                    var dateStr = d.getFullYear() + '/' +
                        String(d.getMonth() + 1).padStart(2, '0') + '/' +
                        String(d.getDate()).padStart(2, '0');
                    var html = '<div style="padding:4px 0;color:#00f0ff;font-weight:bold;">' + dateStr + '</div>';
                    params.forEach(function (p) {
                        if (p.seriesName === 'Volume') {
                            var v = p.value ? p.value[1] : 0;
                            html += '<div style="color:#6b7d95;">VOL: <span style="color:#c8d6e5;">' +
                                formatVolume(v) + '</span></div>';
                        } else if (p.seriesName === 'K线') {
                            var d = p.value || p.data;
                            html += '<div>O: <span style="color:#c8d6e5;">' + formatPrice(d[1]) + '</span> ' +
                                'H: <span style="color:#00ff88;">' + formatPrice(d[4]) + '</span> ' +
                                'L: <span style="color:#ff3b5c;">' + formatPrice(d[3]) + '</span> ' +
                                'C: <span style="color:#c8d6e5;">' + formatPrice(d[2]) + '</span></div>';
                        } else if (p.value != null) {
                            var v = Array.isArray(p.value) ? p.value[1] : p.value;
                            html += '<div><span style="color:' + p.color + ';">●</span> ' +
                                p.seriesName + ': <span style="color:#c8d6e5;">' +
                                formatPrice(v) + '</span></div>';
                        }
                    });
                    return html;
                }
            }
        };

        mainChart.setOption(option, true);
    }

    function updateStats(result) {
        if (!result) return;

        const meta = result.meta || {};
        const quote = result.indicators?.quote?.[0];

        if (quote) {
            const opens = quote.open || [];
            const highs = quote.high || [];
            const lows = quote.low || [];
            const closes = quote.close || [];
            const volumes = quote.volume || [];
            const lastIdx = opens.length - 1;

            const lastOpen = lastIdx >= 0 ? opens[lastIdx] : null;
            const lastHigh = lastIdx >= 0 ? highs[lastIdx] : null;
            const lastLow = lastIdx >= 0 ? lows[lastIdx] : null;
            const lastVol = lastIdx >= 0 ? volumes[lastIdx] : null;

            const prevClose = meta.previousClose || meta.chartPreviousClose || null;
            const dayHigh = meta.regularMarketDayHigh || lastHigh;
            const dayLow = meta.regularMarketDayLow || lastLow;
            const high52 = meta.fiftyTwoWeekHigh || null;
            const low52 = meta.fiftyTwoWeekLow || null;

            dom.stats.open.textContent = lastOpen != null ? '$' + formatPrice(lastOpen) : '--';
            dom.stats.prev.textContent = prevClose != null ? '$' + formatPrice(prevClose) : '--';
            dom.stats.high.textContent = dayHigh != null ? '$' + formatPrice(dayHigh) : '--';
            dom.stats.low.textContent = dayLow != null ? '$' + formatPrice(dayLow) : '--';
            dom.stats.high52.textContent = high52 != null ? '$' + formatPrice(high52) : '--';
            dom.stats.low52.textContent = low52 != null ? '$' + formatPrice(low52) : '--';
            dom.stats.vol.textContent = lastVol != null ? formatVolume(lastVol) : '--';

            var sma200 = calcMA(closes, 200);
            var sma200Valid = sma200.filter(function (v) { return v != null; });
            var sma200Val = sma200Valid.length > 0 ? sma200Valid[sma200Valid.length - 1] : null;
            dom.stats.sma200.textContent = sma200Val != null ? '$' + formatPrice(sma200Val) : '--';

            var maxDrawdown = calcMaxDrawdown(closes);
            dom.stats.drawdown.textContent = maxDrawdown != null ? '-' + maxDrawdown.toFixed(2) + '%' : '--';

            var maxGain = calcMaxGain(closes);
            dom.stats.maxgain.textContent = maxGain != null ? '+' + maxGain.toFixed(2) + '%' : '--';

            if (dayHigh != null && prevClose != null && dayHigh >= prevClose) {
                dom.stats.high.className = 'stat-value up';
            } else {
                dom.stats.high.className = 'stat-value down';
            }
            if (dayLow != null && prevClose != null && dayLow >= prevClose) {
                dom.stats.low.className = 'stat-value up';
            } else {
                dom.stats.low.className = 'stat-value down';
            }
        }

        const currentPrice = meta.regularMarketPrice || null;
        const prevClose2 = meta.previousClose || meta.chartPreviousClose || null;

        if (activeSymbol && currentPrice != null) {
            const priceEl = document.getElementById('price-' + activeSymbol);
            const changeEl = document.getElementById('change-' + activeSymbol);
            if (priceEl) {
                const oldPrice = priceEl.textContent;
                const newPrice = '$' + formatPrice(currentPrice);
                if (oldPrice !== newPrice && oldPrice !== '--') {
                    priceEl.classList.add('updating');
                    setTimeout(function () { priceEl.classList.remove('updating'); }, 300);
                }
                priceEl.textContent = newPrice;
            }
            if (changeEl && prevClose2 != null) {
                const ch = formatChange(currentPrice, prevClose2);
                changeEl.textContent = ch.text;
                changeEl.className = 'card-change ' + ch.cls;
            }
        }
    }

    async function loadAndRender(symbol, interval, setActive) {
        if (setActive) {
            activeSymbol = symbol;
            activeInterval = interval || '1d';
        }

        var intervalNames = { '1d': '日K', '1wk': '周K', '1mo': '月K', '3mo': '季K', '1y': '年K' };
        dom.chartTitle.textContent = symbol + ' — ' + (intervalNames[activeInterval] || '日K') + ' CANDLESTICK';

        var cards = dom.cards.querySelectorAll('.card');
        cards.forEach(function (c) {
            c.classList.toggle('active', c.dataset.symbol === symbol);
        });

        var intervalBtns = dom.intervalSelector.querySelectorAll('.range-btn');
        intervalBtns.forEach(function (b) {
            b.classList.toggle('active', b.dataset.interval === activeInterval);
        });

        var result = stockData[symbol + '_' + dataRange];
        if (!result) {
            var fresh = await fetchStockData([symbol], dataRange);
            result = fresh[symbol];
            if (result) {
                stockData[symbol + '_' + dataRange] = result;
            }
        }

        if (!result) {
            console.error('No data for ' + symbol);
            return;
        }

        var chartData = buildCandlestickData(result);
        chartData = aggregateData(chartData, activeInterval);
        renderMainChart(chartData);
        updateStats(result);
    }

    async function initAllCards() {
        var promises = SYMBOLS.map(async function (sym) {
            try {
                var results = await fetchStockData([sym], '5d');
                var result = results[sym];
                if (!result) return;
                stockData[sym + '_5d'] = result;
                var meta = result.meta || {};
                var price = meta.regularMarketPrice;
                var prevClose = meta.previousClose || meta.chartPreviousClose;
                var priceEl = document.getElementById('price-' + sym);
                var changeEl = document.getElementById('change-' + sym);
                if (priceEl) priceEl.textContent = '$' + formatPrice(price);
                if (changeEl) {
                    var ch = formatChange(price, prevClose);
                    changeEl.textContent = ch.text;
                    changeEl.className = 'card-change ' + ch.cls;
                }
            } catch (e) {
                console.warn('Init card ' + sym + ' failed:', e.message);
            }
        });
        await Promise.all(promises);
    }

    function initCardEvents() {
        dom.cards.addEventListener('click', function (e) {
            var card = e.target.closest('.card');
            if (!card) return;
            var symbol = card.dataset.symbol;
            if (symbol) loadAndRender(symbol, activeInterval, true);
        });

        dom.cards.querySelectorAll('.card').forEach(function (card) {
            card.addEventListener('mousemove', function (e) {
                var rect = card.getBoundingClientRect();
                var x = ((e.clientX - rect.left) / rect.width) * 100;
                var y = ((e.clientY - rect.top) / rect.height) * 100;
                card.style.setProperty('--mouse-x', x + '%');
                card.style.setProperty('--mouse-y', y + '%');
            });
        });
    }

    function initIntervalEvents() {
        dom.intervalSelector.addEventListener('click', function (e) {
            var btn = e.target.closest('.range-btn');
            if (!btn) return;
            var interval = btn.dataset.interval;
            if (interval) loadAndRender(activeSymbol, interval, true);
        });
    }

    function initBackground() {
        var canvas = document.getElementById('bg-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var particles = [];
        var maxParticles = 80;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        for (var i = 0; i < maxParticles; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                size: Math.random() * 1.5 + 0.5,
                speedX: (Math.random() - 0.5) * 0.3,
                speedY: (Math.random() - 0.5) * 0.3,
                opacity: Math.random() * 0.5 + 0.2
            });
        }

        var gridSize = 80;
        var gridOffset = 0;

        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            ctx.strokeStyle = 'rgba(0,240,255,0.03)';
            ctx.lineWidth = 0.5;
            gridOffset = (gridOffset + 0.15) % gridSize;
            for (var x = gridOffset; x < canvas.width; x += gridSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }
            for (var y = gridOffset; y < canvas.height; y += gridSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }

            for (var i = 0; i < particles.length; i++) {
                var p = particles[i];
                p.x += p.speedX;
                p.y += p.speedY;

                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = 0;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,240,255,' + p.opacity + ')';
                ctx.fill();
            }

            for (var i = 0; i < particles.length; i++) {
                for (var j = i + 1; j < particles.length; j++) {
                    var dx = particles[i].x - particles[j].x;
                    var dy = particles[i].y - particles[j].y;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = 'rgba(0,240,255,' + (0.04 * (1 - dist / 120)) + ')';
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(draw);
        }
        draw();
    }

    function updateClock() {
        var now = new Date();
        var h = String(now.getHours()).padStart(2, '0');
        var m = String(now.getMinutes()).padStart(2, '0');
        var s = String(now.getSeconds()).padStart(2, '0');
        dom.clock.textContent = h + ':' + m + ':' + s;
    }

    async function init() {
        initBackground();
        initCharts();
        initCardEvents();
        initIntervalEvents();
        updateClock();
        setInterval(updateClock, 1000);

        var defaultCard = dom.cards.querySelector('.card[data-symbol="QQQ"]');
        if (defaultCard) defaultCard.classList.add('active');

        await initAllCards();
        await loadAndRender('QQQ', '1d', true);
    }

    document.addEventListener('DOMContentLoaded', init);
})();
