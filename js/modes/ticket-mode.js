/**
 * 票据模式 - 支付凭证
 * 功能：支付跟踪、已付/待付金额
 */

(function() {
  'use strict';

  const TicketMode = {
    name: 'ticket',
    data: null,

    async init() {
      // 配置数据已迁移至 Firebase，无需加载本地 JSON
      console.log('✅ Ticket mode initialized');
    },

    activate() {
      document.querySelectorAll('.bill-only').forEach(el => {
        el.style.display = 'none';
      });
      document.querySelectorAll('.ticket-only').forEach(el => {
        el.style.display = 'block';
      });
    },

    deactivate() {
      document.querySelectorAll('.ticket-only').forEach(el => {
        el.style.display = 'none';
      });
    }
  };

  window.TicketMode = TicketMode;
  console.log('✅ Ticket mode module loaded');
})();
