// Spark Offer Analyzer - Analyze delivery offers for maximum profit
(function() {
  const app = document.getElementById('app');

  // State
  let settings = JSON.parse(localStorage.getItem('sparkSettings') || 'null') || {
    gasPrice: 2.80,
    mpg: 18,
    costPerMile: 0.08,
    currentLocation: 'Walmart'
  };
  let offers = JSON.parse(localStorage.getItem('sparkOffers') || '[]');

  function saveSettings() {
    localStorage.setItem('sparkSettings', JSON.stringify(settings));
  }

  function saveOffers() {
    localStorage.setItem('sparkOffers', JSON.stringify(offers));
  }

  function calculateOffer(offer) {
    const totalMiles = offer.miles * 2; // Round trip
    const gasCost = (totalMiles / settings.mpg) * settings.gasPrice;
    const wearCost = totalMiles * settings.costPerMile;
    const totalCost = gasCost + wearCost;
    const netProfit = offer.pay - totalCost;
    const profitPerMile = netProfit / totalMiles;
    const estimatedMinutes = offer.estimatedMinutes || (totalMiles * 2.5); // ~2.5 min per mile estimate
    const hourlyRate = (netProfit / estimatedMinutes) * 60;

    return {
      ...offer,
      totalMiles,
      gasCost,
      wearCost,
      totalCost,
      netProfit,
      profitPerMile,
      hourlyRate,
      estimatedMinutes,
      isProfitable: netProfit > 0,
      rating: netProfit > 10 ? 'great' : netProfit > 5 ? 'good' : netProfit > 0 ? 'okay' : 'bad'
    };
  }

  function render() {
    const analyzedOffers = offers.map(calculateOffer).sort((a, b) => b.netProfit - a.netProfit);
    const bestOffer = analyzedOffers.length > 0 ? analyzedOffers[0] : null;

    app.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .spark-app { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding-bottom: 100px; }
        .header { background: linear-gradient(135deg, #FF6B00 0%, #FF8C00 100%); color: white; padding: 20px; border-radius: 16px; margin-bottom: 20px; }
        .header h1 { margin: 0 0 4px 0; font-size: 24px; }
        .header p { margin: 0; opacity: 0.9; font-size: 14px; }
        .card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .card h2 { margin: 0 0 16px 0; font-size: 18px; color: #333; display: flex; align-items: center; gap: 8px; }
        .form-row { margin-bottom: 14px; }
        .form-row label { display: block; font-size: 13px; color: #666; margin-bottom: 6px; font-weight: 500; }
        .form-row input { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 16px; transition: border-color 0.2s; }
        .form-row input:focus { outline: none; border-color: #FF6B00; }
        .form-row small { display: block; margin-top: 4px; color: #999; font-size: 12px; }
        .btn { padding: 14px 24px; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; transition: transform 0.1s, opacity 0.2s; }
        .btn:active { transform: scale(0.98); }
        .btn-primary { background: linear-gradient(135deg, #FF6B00 0%, #FF8C00 100%); color: white; }
        .btn-secondary { background: #f0f0f0; color: #333; }
        .btn-danger { background: #ff4444; color: white; }
        .offer-card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-left: 4px solid #ccc; }
        .offer-card.great { border-left-color: #00C853; }
        .offer-card.good { border-left-color: #FF6B00; }
        .offer-card.okay { border-left-color: #FFC107; }
        .offer-card.bad { border-left-color: #ff4444; }
        .offer-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .offer-pay { font-size: 24px; font-weight: 700; color: #333; }
        .offer-badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
        .badge-great { background: #E8F5E9; color: #00C853; }
        .badge-good { background: #FFF3E0; color: #FF6B00; }
        .badge-okay { background: #FFF8E1; color: #F9A825; }
        .badge-bad { background: #FFEBEE; color: #ff4444; }
        .offer-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .stat { background: #f8f8f8; padding: 10px; border-radius: 8px; }
        .stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
        .stat-value { font-size: 16px; font-weight: 600; color: #333; margin-top: 2px; }
        .stat-value.profit { color: #00C853; }
        .stat-value.loss { color: #ff4444; }
        .offer-breakdown { font-size: 13px; color: #666; padding-top: 12px; border-top: 1px solid #eee; }
        .breakdown-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .best-banner { background: linear-gradient(135deg, #00C853 0%, #00E676 100%); color: white; padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
        .best-banner svg { flex-shrink: 0; }
        .settings-toggle { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; cursor: pointer; }
        .settings-content { display: none; padding-top: 12px; border-top: 1px solid #eee; }
        .settings-content.open { display: block; }
        .remove-btn { background: none; border: none; color: #ff4444; font-size: 20px; cursor: pointer; padding: 4px 8px; }
        .empty-state { text-align: center; padding: 40px 20px; color: #888; }
        .empty-state svg { margin-bottom: 16px; opacity: 0.5; }
        .input-group { display: flex; gap: 8px; }
        .input-group input { flex: 1; }
        .quick-calc { background: #f0f7ff; border-radius: 10px; padding: 12px; margin-top: 12px; }
        .quick-calc-title { font-size: 12px; color: #666; margin-bottom: 8px; }
        .tabs { display: flex; gap: 8px; margin-bottom: 16px; }
        .tab { flex: 1; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; background: white; font-size: 14px; font-weight: 500; cursor: pointer; text-align: center; }
        .tab.active { border-color: #FF6B00; background: #FFF3E0; color: #FF6B00; }
      </style>

      <div class="spark-app">
        <div class="header">
          <h1>Spark Offer Analyzer</h1>
          <p>Find the most profitable delivery offers</p>
        </div>

        ${bestOffer && bestOffer.isProfitable ? `
          <div class="best-banner">
            <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <div>
              <strong>Best Offer: $${bestOffer.pay.toFixed(2)}</strong>
              <div style="font-size:13px;opacity:0.9;">Net profit: $${bestOffer.netProfit.toFixed(2)} ($${bestOffer.hourlyRate.toFixed(2)}/hr)</div>
            </div>
          </div>
        ` : ''}

        <div class="card">
          <h2>Add New Offer</h2>
          <div class="form-row">
            <label>Offer Pay ($)</label>
            <input type="number" id="offerPay" placeholder="15.00" step="0.01" inputmode="decimal">
          </div>
          <div class="form-row">
            <label>Miles Shown on Offer</label>
            <input type="number" id="offerMiles" placeholder="8" step="0.1" inputmode="decimal">
            <small>Will be doubled for round trip back to Walmart</small>
          </div>
          <div class="form-row">
            <label>Estimated Time (minutes, optional)</label>
            <input type="number" id="offerTime" placeholder="30" inputmode="numeric">
          </div>
          <div id="quickCalc" class="quick-calc" style="display:none;">
            <div class="quick-calc-title">Quick Preview</div>
            <div id="quickCalcContent"></div>
          </div>
          <button class="btn btn-primary" onclick="window.addOffer()" style="margin-top:12px;">
            Analyze Offer
          </button>
        </div>

        <div class="card">
          <div class="settings-toggle" onclick="window.toggleSettings()">
            <h2 style="margin:0;">Settings</h2>
            <span id="settingsArrow">▼</span>
          </div>
          <div id="settingsContent" class="settings-content">
            <div class="form-row">
              <label>Gas Price ($/gallon)</label>
              <input type="number" id="gasPrice" value="${settings.gasPrice}" step="0.01" inputmode="decimal" onchange="window.updateSettings()">
            </div>
            <div class="form-row">
              <label>Your Vehicle MPG</label>
              <input type="number" id="mpg" value="${settings.mpg}" step="0.1" inputmode="decimal" onchange="window.updateSettings()">
              <small>Miles per gallon for your truck</small>
            </div>
            <div class="form-row">
              <label>Cost Per Mile (wear & tear)</label>
              <input type="number" id="costPerMile" value="${settings.costPerMile}" step="0.01" inputmode="decimal" onchange="window.updateSettings()">
              <small>Maintenance, tires, depreciation (default: $0.08)</small>
            </div>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;">Analyzed Offers (${analyzedOffers.length})</h2>
            ${analyzedOffers.length > 0 ? `<button class="btn btn-secondary" style="width:auto;padding:8px 16px;font-size:14px;" onclick="window.clearOffers()">Clear All</button>` : ''}
          </div>

          ${analyzedOffers.length === 0 ? `
            <div class="empty-state">
              <svg width="48" height="48" fill="none" stroke="#ccc" stroke-width="1.5">
                <circle cx="24" cy="24" r="20"/>
                <path d="M24 14v10M24 28v2"/>
              </svg>
              <p>No offers yet. Add an offer above to see the analysis.</p>
            </div>
          ` : analyzedOffers.map((offer, i) => `
            <div class="offer-card ${offer.rating}">
              <div class="offer-header">
                <span class="offer-pay">$${offer.pay.toFixed(2)}</span>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span class="offer-badge badge-${offer.rating}">
                    ${offer.rating === 'great' ? 'Great Deal' : offer.rating === 'good' ? 'Good' : offer.rating === 'okay' ? 'Okay' : 'Skip It'}
                  </span>
                  <button class="remove-btn" onclick="window.removeOffer(${i})">×</button>
                </div>
              </div>
              <div class="offer-stats">
                <div class="stat">
                  <div class="stat-label">Net Profit</div>
                  <div class="stat-value ${offer.netProfit >= 0 ? 'profit' : 'loss'}">
                    ${offer.netProfit >= 0 ? '+' : ''}$${offer.netProfit.toFixed(2)}
                  </div>
                </div>
                <div class="stat">
                  <div class="stat-label">Hourly Rate</div>
                  <div class="stat-value ${offer.hourlyRate >= 15 ? 'profit' : offer.hourlyRate >= 10 ? '' : 'loss'}">
                    $${offer.hourlyRate.toFixed(2)}/hr
                  </div>
                </div>
                <div class="stat">
                  <div class="stat-label">Total Miles</div>
                  <div class="stat-value">${offer.totalMiles.toFixed(1)} mi</div>
                </div>
                <div class="stat">
                  <div class="stat-label">Profit/Mile</div>
                  <div class="stat-value ${offer.profitPerMile >= 0.50 ? 'profit' : offer.profitPerMile >= 0 ? '' : 'loss'}">
                    $${offer.profitPerMile.toFixed(2)}/mi
                  </div>
                </div>
              </div>
              <div class="offer-breakdown">
                <div class="breakdown-row">
                  <span>Offer miles (one way)</span>
                  <span>${offer.miles} mi</span>
                </div>
                <div class="breakdown-row">
                  <span>Round trip distance</span>
                  <span>${offer.totalMiles.toFixed(1)} mi</span>
                </div>
                <div class="breakdown-row">
                  <span>Gas cost (${settings.mpg} MPG @ $${settings.gasPrice}/gal)</span>
                  <span style="color:#ff6b00;">-$${offer.gasCost.toFixed(2)}</span>
                </div>
                <div class="breakdown-row">
                  <span>Wear & tear ($${settings.costPerMile}/mi)</span>
                  <span style="color:#ff6b00;">-$${offer.wearCost.toFixed(2)}</span>
                </div>
                <div class="breakdown-row" style="font-weight:600;margin-top:8px;padding-top:8px;border-top:1px dashed #ddd;">
                  <span>Your Actual Earnings</span>
                  <span style="color:${offer.netProfit >= 0 ? '#00C853' : '#ff4444'};">$${offer.netProfit.toFixed(2)}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="card" style="background:#f8f9fa;">
          <h2 style="font-size:14px;color:#666;">How It Works</h2>
          <ul style="font-size:13px;color:#888;margin:0;padding-left:20px;line-height:1.8;">
            <li>Miles are <strong>doubled</strong> for the return trip to Walmart</li>
            <li>Gas cost = Total miles ÷ MPG × Gas price</li>
            <li>Wear cost = Total miles × $${settings.costPerMile}/mile</li>
            <li>Net profit = Offer pay - Gas - Wear & tear</li>
          </ul>
        </div>
      </div>
    `;

    // Add live preview for quick calc
    const payInput = document.getElementById('offerPay');
    const milesInput = document.getElementById('offerMiles');
    const quickCalc = document.getElementById('quickCalc');
    const quickCalcContent = document.getElementById('quickCalcContent');

    function updateQuickCalc() {
      const pay = parseFloat(payInput.value);
      const miles = parseFloat(milesInput.value);

      if (pay > 0 && miles > 0) {
        const calc = calculateOffer({ pay, miles });
        quickCalc.style.display = 'block';
        quickCalcContent.innerHTML = `
          <div style="display:flex;justify-content:space-between;font-size:14px;">
            <span>Round trip: ${calc.totalMiles} mi</span>
            <span>Costs: $${calc.totalCost.toFixed(2)}</span>
            <span style="font-weight:600;color:${calc.netProfit >= 0 ? '#00C853' : '#ff4444'};">
              Net: $${calc.netProfit.toFixed(2)}
            </span>
          </div>
        `;
      } else {
        quickCalc.style.display = 'none';
      }
    }

    payInput.addEventListener('input', updateQuickCalc);
    milesInput.addEventListener('input', updateQuickCalc);
  }

  window.addOffer = function() {
    const pay = parseFloat(document.getElementById('offerPay').value);
    const miles = parseFloat(document.getElementById('offerMiles').value);
    const time = parseInt(document.getElementById('offerTime').value) || null;

    if (!pay || pay <= 0) {
      alert('Please enter the offer pay amount');
      return;
    }
    if (!miles || miles <= 0) {
      alert('Please enter the miles shown on the offer');
      return;
    }

    offers.unshift({
      pay,
      miles,
      estimatedMinutes: time,
      addedAt: new Date().toISOString()
    });

    saveOffers();
    render();

    // Clear inputs
    document.getElementById('offerPay').value = '';
    document.getElementById('offerMiles').value = '';
    document.getElementById('offerTime').value = '';
  };

  window.removeOffer = function(index) {
    offers.splice(index, 1);
    saveOffers();
    render();
  };

  window.clearOffers = function() {
    if (confirm('Clear all analyzed offers?')) {
      offers = [];
      saveOffers();
      render();
    }
  };

  window.toggleSettings = function() {
    const content = document.getElementById('settingsContent');
    const arrow = document.getElementById('settingsArrow');
    content.classList.toggle('open');
    arrow.textContent = content.classList.contains('open') ? '▲' : '▼';
  };

  window.updateSettings = function() {
    settings.gasPrice = parseFloat(document.getElementById('gasPrice').value) || 2.80;
    settings.mpg = parseFloat(document.getElementById('mpg').value) || 18;
    settings.costPerMile = parseFloat(document.getElementById('costPerMile').value) || 0.08;
    saveSettings();
    render();
  };

  // Initial render
  render();
})();
