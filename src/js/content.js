// From settings.js import EXTRA_BALANCE_COLUMNS, getAllSettings.
(function() {

// TODO: Consider using config from Chrome sync storage.
var config = {
  // Number of rounding decimals for USD value display.
  'USD_DECIMALS': 2,
  // Number of rounding decimals for percentage display.
  'CHANGE_PERCENT_DECIMALS': 2,
  // Number of rounding decimals for crypto currency display.
  'COIN_DECIMALS': 8,
  // Precision for values: everything below is considered 0.
  'BALANCE_PRECISION': 1e-7,
  // Period for XHR requests to sync with latest history.
  'HISTORY_UPDATE_INTERVAL_MS': 120000,
  // Minimum period for writing to Chrome storage.
  'STORAGE_WRITE_INTERVAL_MS': 10000,
  // Maximum time to wait for the progress bar to start filling up.
  'PROGRESS_MAX_WAIT_MS': 60000,
  // Period for checking the progress bar status.
  'PROGRESS_CHECK_PERIOD_MS': 10
}

// The current state.
var state = {
 'data': null,
 'history': null,
 'depositsAndWithdrawals': null,
 'avgBuyPriceOfCoin': null,
 'earningsBtcOfCoin': null,
 'lastStorageWrite': 0,
 'lastHistoryUpdate': 0,
 'lastDepositsAndWithdrawalsUpdate': 0
};

// Asnychronous version of the each method to keep responsiveness.
$.fn.extend({
  eachAsync: function(callback) {
    $(this).each(function() {
      var $element = $(this);
      setTimeout(function() {
        callback.call($element);
      }, 10);
    })
  }
});

// Returns the current timestamp as integer.
function getTimestamp() {
  return + new Date();
}

// Returns the path portion of the current page without the leading slash.
function getPagePath() {
  var urlParts = window.location.href.split("/");
  return urlParts.splice(3).join("/");
}

// Fires a callback with all results once all methods have completed.
function onAllComplete(asyncMethodMap, callback) {
  var results = {};
  var callbacksRemaining = Object.keys(asyncMethodMap).length;
  for (var name in asyncMethodMap) {
    (function(name, asyncMethod, asyncMethodCallback) {
      asyncMethod(function() {
        $.extend(results, asyncMethodCallback.apply(this, arguments));
        if (--callbacksRemaining == 0) {
          callback(results);
        }
      });
    })(name, asyncMethodMap[name][0], asyncMethodMap[name][1]);
  }
}

// Fires a callback once at init and each time DOM is modified.
function onInitAndChange(query, callback) {
  $(query).eachAsync(function() {
    var $element = $(this);
    $element.bind("DOMSubtreeModified", function(e) {
      callback($element);
    });
    callback($element);
  });
}

// Returns a numeric value from inner HTML or null if not available.
function getFloatValueFromDom(query) {
  if ($(query).length == 0)
    return null;

  var value = parseFloat($(query).text());
  if (value != NaN && value != Infinity) {
    return value;
  }

  return null;
}

// Formats a value displayed as change with fixed number of decimals and sign.
function formatAsChange(value, decimals) {
  return (value > 0 ? "+" : "") + value.toFixed(decimals);
}

// Returns the class of the change.
function getChangeClass(value) {
  if (Math.abs(value) < config.BALANCE_PRECISION) {
    return "neutral";
  } else if (value < 0) {
    return "negative";
  } else {
    return "positive";
  }
}

// Applies the colorized css class to a cell based on it's value.
function applyChangeClass($cell, value) {
  $cell
      .removeClass("neutral")
      .removeClass("positive")
      .removeClass("negative")
      .addClass(getChangeClass(value));
}

// Computes the growth rate in percentages comparing an old and new value.
function computeGrowthRate(oldValue, newValue) {
  return (newValue - oldValue) * 100.0 / oldValue;
}

// Applies all settings to the page.
function applySettings(settings) {
  updateColumnVisibility(settings['balance_column_visibility']);
}

// Loads the cached state from Chrome local storage.
function loadCachedState(callback) {
  chrome.storage.local.get('state', function(r) {
    if (r.state) {
      for (var k in state) {
        if (k in r.state) {
          state[k] = r.state[k];
        }
      }
    };
    if (callback) {
      callback(state);
    }
  });
}

// Saves the cached state to Chrome local storage.
function saveCachedState(callback) {
  if ((getTimestamp() - state.lastStorageWrite) >
      config.STORAGE_WRITE_INTERVAL_MS) {
    state.lastStorageWrite = getTimestamp();
    chrome.storage.local.set({'state': state}, function() {
      if (callback) {
        callback(state);
      }
    });
  }
}

// Adjusts the theme (dark/light) context.
function adjustTheme() {
  if ($("link[href*='dark']").length > 0) {
    $("body").addClass("poloniex-ninja-dark");
  }
}

// Updates column visibility from the settings object and adjusts the table
// width according to number of visible columns.
function updateColumnVisibility(visibility) {
  var visibleColumnCount = 0;
  for (var column in visibility) {
    var $el = $(".poloniex-ninja." + column);
    if ($el.length == 0)
      continue;

    if (visibility[column]) {
      $el.removeClass("poloniex-ninja-hidden");
      visibleColumnCount++;
    } else {
      $el.addClass("poloniex-ninja-hidden");
    }
  }

  // Stretch the table according to number of visible extra columns.
  $("#content > .main")
      .attr('class', function(i, c) {
        return c.replace(/(^|\s)poloniex-ninja-stretch-\w+/g, '');
      })
      .addClass("poloniex-ninja-stretch-" + visibleColumnCount);
}

// Fires the callback once the progress bar has loaded.
function onProgressComplete(callback) {
  var remainingTime = config.PROGRESS_MAX_WAIT_MS;
  var period = config.PROGRESS_CHECK_PERIOD_MS;
  var interval = setInterval(function() {
    remainingTime -= period;
    if (remainingTime <= 0) {
      clearInterval(interval);
      return;
    }
    var style = $("#wdProgress").attr("style");
    if (style && parseFloat(style.split(': ').pop()) >= 50) {
      callback();
      clearInterval(interval);
    }
  }, period);
}

// Loads the entire trade history for average buy value and change estimate.
// The results may be cached. A callback is executed with the results and
// a boolean argument determining whether the results are cached.
function loadTradeHistory(callback) {
  if ((getTimestamp() - state.lastHistoryUpdate) >
      config.HISTORY_UPDATE_INTERVAL_MS) {
    $.getJSON(
      "/private.php?command=returnPersonalTradeHistory&start=0&end=1917895987",
      function(history) {
        state.history = history;
        state.lastHistoryUpdate = getTimestamp();
        callback(history, /*cached=*/false);
      });
  } else {
    // Provide cached results.
    callback(state.history, /*cached=*/true);
  }
}

// Loads the last 1000 deposits and withdrawals.
function loadDepositsAndWithdrawalsHistory(callback) {
  if ((getTimestamp() - state.lastDepositsAndWithdrawalsUpdate) >
      config.HISTORY_UPDATE_INTERVAL_MS) {
    $.getJSON(
      "/private?command=returnWithdrawalsDeposits&limit=1000",
      function(depositsAndWithdrawals) {
        state.depositsAndWithdrawals = depositsAndWithdrawals;
        state.lastDepositsAndWithdrawalsUpdate = getTimestamp();
        callback(depositsAndWithdrawals, /*cached=*/false);
      });
  } else {
    // Provide cached results.
    callback(state.depositsAndWithdrawals, /*cached=*/true);
  }
}

// Loads all transactions (trade history and deposits & withdrawals).
function loadTransactions(callback) {
  onAllComplete({
      'loadTradeHistory': [
          loadTradeHistory,
          function(history, cached) {
            return {'history': history, 'historyCached': cached};
          }],
      'loadDepositsAndWithdrawalsHistory': [
          loadDepositsAndWithdrawalsHistory,
          function(depositsAndWithdrawals, cached) {
            return {'depositsAndWithdrawals': depositsAndWithdrawals,
                    'depositsAndWithdrawalsCached': cached};
          }]
      },
      function(results) {
        callback(results.history,
                 results.depositsAndWithdrawals.deposits,
                 results.depositsAndWithdrawals.withdrawals,
                 results.historyCached && results.depositsAndWithdrawalsCached);
      });
}

// Finds the cell in the provided row matching the given header text.
function getCellForHeader($rowElement, headerText) {
  var $matchingHeader =
      $("#balancesTable thead th div:contains('" + headerText + "')");
  if ($matchingHeader.length == 0)
    return null;
  var index = $matchingHeader.closest("th").prevAll().length;
  return $($rowElement).find("td:eq(" + index + ")");
}

// Gets the total estimate of holdings in USD or null if not available.
function getUsdHoldings() {
  return getFloatValueFromDom("#accountValue_usd");
}

// Gets the total estimate of holdings in BTC or null if not available.
function getBtcHoldings() {
  return getFloatValueFromDom("#accountValue_btc");
}

// Returns the bitcoin value in the provided row or null if not available.
function getBitcoinValue($row) {
  var $bitcoinValueCell = getCellForHeader($row, "BTC Value");
  return getFloatValueFromDom($bitcoinValueCell);
}

// Gets the estimated value of BTC in USD or 0 if not available.
function getBtcPriceEstimate() {
 var usdHoldings = getUsdHoldings();
 if (usdHoldings == null)
   return 0.0;

 var btcHoldings = getBtcHoldings();
 if (btcHoldings == null || btcHoldings == 0.0)
   return 0.0;

  return usdHoldings / btcHoldings;
}

// Get the row associated with the coin.
function getCoinRow(coinName) {
  return $("#balancesTable tr[data-url='" + coinName + "']");
}

// Fetches the cached historical trade data for a given row and calls the
// callback if data is available.
function getTradeSummaryForRow($row, callback) {
  var coin = $row.find("td.coin").text();
  if (coin == null || state.avgBuyPriceOfCoin == null ||
      !(coin in state.avgBuyPriceOfCoin)) {
    return;
  }

  var currentBalance = getFloatValueFromDom($row.find("td.balance"));
  var btcValue = getFloatValueFromDom($row.find("td.value"));
  var btcPrice = getBtcPriceEstimate();

  var avgBuyPrice = state.avgBuyPriceOfCoin[coin];
  var avgBuyValue = avgBuyPrice * currentBalance;
  var changePercent = computeGrowthRate(avgBuyValue, btcValue);
  var earningsSlsBtc = state.earningsBtcOfCoin[coin];
  var earningsSlsUsd = earningsSlsBtc * btcPrice;

  callback({
    'avgBuyPrice': avgBuyPrice,
    'avgBuyValue': avgBuyValue,
    'changePercent': changePercent,
    'earningsSlsBtc': earningsSlsBtc,
    'earningsSlsUsd': earningsSlsUsd,
  });
}

// Updates USD balance on each row.
function updateUsdBalance($rowQuery) {
  $rowQuery.eachAsync(function() {
    if (!state.data)
      return;

    var $row = $(this);
    var bitcoinValue = getBitcoinValue($row);

    if (bitcoinValue == null)
      return;

    var usdValue =
        (bitcoinValue * state.data.btcPrice).toFixed(config.USD_DECIMALS);

    $row.find(".usd_value:first").html("$ " + usdValue);
  });
}

// Updates the average buy price, value and other trade related columns
// in one or more rows.
function updateTradeColumns($rowQuery) {
  $rowQuery.eachAsync(function() {
    var $row = $(this);
    getTradeSummaryForRow($row, function(r) {
      var $avgBuyPriceCell = $row.find("td.avg_buy_price");
      var $avgBuyValueCell = $row.find("td.avg_buy_value");
      var $earningsSlsBtcCell = $row.find("td.earnings_sls_btc");
      var $earningsSlsUsdCell = $row.find("td.earnings_sls_usd");
      $avgBuyPriceCell.html(
          r.avgBuyPrice.toFixed(config.COIN_DECIMALS));
      $avgBuyValueCell.html(
          r.avgBuyValue.toFixed(config.COIN_DECIMALS));
      $earningsSlsBtcCell.html(
          formatAsChange(r.earningsSlsBtc, config.COIN_DECIMALS));
      applyChangeClass($earningsSlsBtcCell, r.earningsSlsBtc);
      $earningsSlsUsdCell.html(
          '$ ' + formatAsChange(r.earningsSlsUsd, config.USD_DECIMALS));
      applyChangeClass($earningsSlsUsdCell, r.earningsSlsUsd);
    });
  });
}

// Updates the change column in one or more rows.
function updateChangePercent($rowQuery) {
  $rowQuery.eachAsync(function() {
    var $row = $(this);
    getTradeSummaryForRow($row, function(r) {
      var $changePercentCell = $row.find("td.change_percent");
      $changePercentCell.html(formatAsChange(r.changePercent,
                                             config.CHANGE_PERCENT_DECIMALS));
      applyChangeClass($changePercentCell, r.changePercent);
    });
  });
}

// Computes the average buy price from the trade history.
function computeAvgBuyPrice(transactions, boundaryTransactions,
                            currentBalance) {
  var balance = currentBalance;
  var rates = [];
  var totalBuyAmount = 0.0;
  var computed = false;

  // Subtract all deposits and withdrawals from current balance. This will
  // account for the part of the current balance. Notice that withdrawals are
  // always negative.
  for (var i = 0; i < boundaryTransactions.length; i++) {
    balance -= boundaryTransactions[i].amount;
  }

  // Scrub through the history and determine the rates and amounts for buys.
  for (var i = 0; i < transactions.length; i++) {
    var t = transactions[i];
    var amount = parseFloat(t.amount);
    var fee = parseFloat(t.fee);
    var rate = parseFloat(t.rate);
    var sign = (t.type == "buy") ? 1 : -1;
    var netAmount = amount * (1.0 - fee) * sign;
    balance -= netAmount;

    if (t.type == "buy") {
      rates.push({amount: netAmount, rate: rate});
      totalBuyAmount += netAmount;
    }

    if (balance < config.BALANCE_PRECISION)  {
      computed = true;
      break;
    }
  }

  // Failed accoutning for the balance, may be mixture of other currencies.
  if (!computed)
    return null;

  // Compute the average buy price.
  var avgBuyPrice = 0.0;
  for (var i = 0; i < rates.length; i++) {
    avgBuyPrice += rates[i].rate * (rates[i].amount / totalBuyAmount);
  }

  return avgBuyPrice;
}

// Computes the BTC earnings for given coin up until and including the most
// recent sale. This only considers regular exchange trades (buy/sell). If last
// trades were purchases, those are excluded.
function computeEarningsBtc(transactions) {
  var earningsBtc = 0.0;
  var saleFound = false;
  for (var i = 0; i < transactions.length; i++) {
    var t = transactions[i];
    if (t.type == "buy" && saleFound) {
      earningsBtc -= parseFloat(t.total);
    } else if (t.type == "sell") {
      earningsBtc += parseFloat(t.total) * (1.0 - parseFloat(t.fee));
      saleFound = true;
    }
    // FIXME: At some point loans should also be considered.
  }

  return earningsBtc;
}

// Computes the boundary transactions: deposits and withdrawals as the same
// type of entry.
function computeBoundaryTransactions(deposits, withdrawals) {
  var boundaryTransactions = {};
  for (var i = 0; i < deposits.length; i++) {
    var item = deposits[i];
    if (!(item.currency in boundaryTransactions)) {
      boundaryTransactions[item.currency] = [];
    }

    if (item.status != "COMPLETE")
      continue;

    boundaryTransactions[item.currency].push({
      'amount': parseFloat(item.amount),
      'type': 'deposit',
      'currency': item.currency
    });
  }

  for (var i = 0; i < withdrawals.length; i++) {
    var item = withdrawals[i];
    if (!(item.currency in boundaryTransactions)) {
      boundaryTransactions[item.currency] = [];
    }

    if (item.status.indexOf("COMPLETE") < 0)
      continue;

    boundaryTransactions[item.currency].push({
      'amount': -1.0 * (parseFloat(item.amount) + parseFloat(item.fee)),
      'type': 'withdrawal',
      'currency': item.currency
    });
  }

  return boundaryTransactions;
}

// Loads the historical data and saves to the state cache.
// If a callback is provided, it will execute once the cache has been updated.
function computeColumnsFromTradesAsync(callback, forceRecompute) {
  loadTransactions(function(history, deposits, withdrawals, cached) {
    // We don't need to recompute on the cached history unless this is indicated
    // to be the first call via forceRecompute.
    if (!forceRecompute && cached && callback) {
      callback();
      return;
    }

    var boundaryTransactions =
        computeBoundaryTransactions(deposits, withdrawals);

    state.avgBuyPriceOfCoin = {}
    state.earningsBtcOfCoin = {}
    for (var pair in history) {
      var parts = pair.split("_");
      var baseCoin = parts[0];

      // FIXME: Only supporting BTC trading for now.
      if (baseCoin != "BTC") {
        continue;
      }

      var targetCoin = parts[1];
      var $row = getCoinRow(targetCoin);
      var currentBalance = getFloatValueFromDom($row.find("td.balance"));

      // Skip near zero balance.
      if (currentBalance < config.BALANCE_PRECISION) {
        continue;
      }

      // Store the results.
      state.avgBuyPriceOfCoin[targetCoin] =
          computeAvgBuyPrice(history[pair],
                             boundaryTransactions[targetCoin] || [],
                             currentBalance);
      state.earningsBtcOfCoin[targetCoin] = computeEarningsBtc(history[pair]);
    }

    if (callback) {
      callback();
    }

    saveCachedState();
  });
}

// Adds the extra columns for the current balances.
function addExtraBalanceTableColumns() {
  console.info("PoloNinja: Adding extra balance columns.");

  state.data = {btcPrice: getBtcPriceEstimate()};

  // Fix the dynamic rows on deposit/withdraw.
  $("#balancesTable tbody").on("DOMNodeInserted", "tr", function(e) {
    if ($(e.target).attr("id") == "actionRow") {
      $(e.target).find("td:first").attr(
          "colspan", $("#balancesTable thead tr th").length);
    }
  });

  // Attach headers.
  var $lastHeader = $("#balancesTable thead:first tr th:last");
  for (var i = 0; i < EXTRA_BALANCE_COLUMNS.length; i++) {
    var col = EXTRA_BALANCE_COLUMNS[i];
    var header = col.title;
    var $th =
        $("<th class='poloniex-ninja " + col.key + "'>" + col.title + "</th>");
    if ('description' in col) {
      $th.attr("data-tooltip", col.description);
    }
    $th.insertBefore($lastHeader);
  }

  // Apply tooltips to headers.
  $('th.poloniex-ninja[data-tooltip!=""]').qtip({
      content: { attr: 'data-tooltip' },
      style: { classes: 'qtip-dark qtip-rounded qtip-shadow poloTooltips' }
  });

  // Add extra cells for USD as each row is inserted.
  $("#balancesTable tbody").on("DOMNodeInserted", "tr", function(x) {
    if (x.target.nodeName != "TR" || !$(x.target).hasClass("filterable"))
      return;

    var $row = $(x.target);

    // Skip row if already initialized.
    if ($row.find(".poloniex-ninja").length > 0)
      return;

    // Add placeholder cells.
    var $lastColumn = $row.find("td:last");
    for (var i = 0; i < EXTRA_BALANCE_COLUMNS.length; i++) {
      var col = EXTRA_BALANCE_COLUMNS[i];
      $("<td class='poloniex-ninja " + col.key + "'>n/a</td>")
          .insertBefore($lastColumn);
    }
  });

  // Once the progress bar has indicated that stuff is loaded and we got the
  // transaction history cached, fill out the columns and bind events.
  onAllComplete(
      {'onProgressComplete': [onProgressComplete, function() { return {}; }],
       'loadTransactions': [loadTransactions, function() { return {}; }]},
      function() {
        // Apply current settings.
        getAllSettings(applySettings);

        computeColumnsFromTradesAsync(function() {
          var $filterable = $("#balancesTable tbody tr.filterable");

          // Update avg buy price, value and earnings as total balance changes.
          onInitAndChange(
              $filterable.find("td.balance"),
              function($cell) {
                computeColumnsFromTradesAsync(function() {
                  updateTradeColumns($cell.closest("tr"));
                });
              });

          // Update the change column as avg buy value or btc value changes.
          onInitAndChange(
              $filterable.find("td.value, td.avg_buy_value, td.avg_buy_price"),
              function($cell) {
                updateChangePercent($cell.closest("tr"));
              });

          // Update USD prices as bitcoin value changes.
          onInitAndChange(
              $filterable.find("td.value"),
              function($cell) {
                updateUsdBalance($cell.closest("tr"));
              });

          // Update all extra columns as the price changes.
          onInitAndChange(
              "#accountValue_btc",
              function() {
                state.data.btcPrice = getBtcPriceEstimate();
                updateUsdBalance($("#balancesTable tbody tr.filterable"));
                computeColumnsFromTradesAsync(function() {
                  updateTradeColumns(
                      $("#balancesTable tbody tr.filterable"));
                });
              });
        }, /*forceRecompute=*/true);  // computeColumnsFromTradesAsync
      });  // onAllComplete
}

// Program entry point.
function main() {
  // Listen for storage changes.
  chrome.storage.onChanged.addListener(function(changes, namespace) {
    if ("settings" in changes) {
      applySettings(changes["settings"].newValue);
    }
  });

  // Match the page and apply a DOM layer.
  var doAdjustTheme = true;
  if (getPagePath().match(/balances.*/)) {
    loadCachedState(function() {
      addExtraBalanceTableColumns();
    });
  } else {
    console.info("PoloNinja: No modifications were done on this page.");
    doAdjustTheme = false;
  }

  if (doAdjustTheme) {
    adjustTheme();
  }

  // Apply current settings.
  getAllSettings(applySettings);
}

main();

})();  // Scope isolation.
