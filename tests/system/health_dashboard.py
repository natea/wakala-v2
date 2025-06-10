#!/usr/bin/env python3
"""
Wakala Platform System Health Dashboard
Real-time monitoring of all microservices
"""

from flask import Flask, render_template, jsonify
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
import httpx
import asyncio
import redis
import psycopg2
from datetime import datetime, timedelta
import json
from typing import Dict, List, Any
import threading
import time

app = Flask(__name__)

# Service registry
SERVICES = {
    'api_gateway': {'url': 'http://localhost:8080', 'critical': True},
    'auth': {'url': 'http://localhost:8081', 'critical': True},
    'user': {'url': 'http://localhost:8082', 'critical': True},
    'wallet': {'url': 'http://localhost:8083', 'critical': True},
    'transaction': {'url': 'http://localhost:8084', 'critical': True},
    'notification': {'url': 'http://localhost:8085', 'critical': False},
    'settlement': {'url': 'http://localhost:8086', 'critical': True},
    'reporting': {'url': 'http://localhost:8087', 'critical': False},
    'fraud': {'url': 'http://localhost:8088', 'critical': True},
    'compliance': {'url': 'http://localhost:8089', 'critical': True},
    'webhook': {'url': 'http://localhost:8090', 'critical': False},
}

# Global state
system_state = {
    'services': {},
    'metrics': {},
    'alerts': [],
    'last_update': None
}

class HealthMonitor:
    """Monitor system health"""
    
    def __init__(self):
        self.redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
        self.running = True
        
    async def check_service_health(self, name: str, config: Dict) -> Dict:
        """Check individual service health"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{config['url']}/health")
                
                if response.status_code == 200:
                    data = response.json()
                    return {
                        'name': name,
                        'status': 'healthy',
                        'response_time': response.elapsed.total_seconds() * 1000,
                        'details': data,
                        'critical': config['critical']
                    }
                else:
                    return {
                        'name': name,
                        'status': 'unhealthy',
                        'error': f'HTTP {response.status_code}',
                        'critical': config['critical']
                    }
        except Exception as e:
            return {
                'name': name,
                'status': 'unreachable',
                'error': str(e),
                'critical': config['critical']
            }
            
    async def check_database_health(self) -> Dict:
        """Check database health"""
        try:
            conn = psycopg2.connect(
                host="localhost",
                database="wakala",
                user="wakala",
                password="wakala123"
            )
            
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
                
                # Get connection stats
                cursor.execute("""
                    SELECT count(*) as active_connections 
                    FROM pg_stat_activity 
                    WHERE state = 'active'
                """)
                active_connections = cursor.fetchone()[0]
                
                # Get database size
                cursor.execute("""
                    SELECT pg_database_size('wakala') / 1024 / 1024 as size_mb
                """)
                db_size = cursor.fetchone()[0]
                
            conn.close()
            
            return {
                'status': 'healthy',
                'active_connections': active_connections,
                'size_mb': db_size
            }
        except Exception as e:
            return {
                'status': 'unhealthy',
                'error': str(e)
            }
            
    async def check_redis_health(self) -> Dict:
        """Check Redis health"""
        try:
            info = self.redis_client.info()
            
            return {
                'status': 'healthy',
                'connected_clients': info['connected_clients'],
                'used_memory_mb': info['used_memory'] / 1024 / 1024,
                'total_commands_processed': info['total_commands_processed']
            }
        except Exception as e:
            return {
                'status': 'unhealthy',
                'error': str(e)
            }
            
    async def get_system_metrics(self) -> Dict:
        """Get system-wide metrics"""
        try:
            # Get transaction metrics from Redis
            total_transactions = self.redis_client.get('metrics:transactions:total') or 0
            failed_transactions = self.redis_client.get('metrics:transactions:failed') or 0
            active_users = self.redis_client.scard('active_users') or 0
            
            # Calculate success rate
            success_rate = 0
            if int(total_transactions) > 0:
                success_rate = (1 - (int(failed_transactions) / int(total_transactions))) * 100
                
            return {
                'total_transactions': int(total_transactions),
                'failed_transactions': int(failed_transactions),
                'success_rate': round(success_rate, 2),
                'active_users': active_users,
                'timestamp': datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {
                'error': str(e)
            }
            
    async def monitor_loop(self):
        """Main monitoring loop"""
        while self.running:
            # Check all services
            service_checks = []
            for name, config in SERVICES.items():
                service_checks.append(self.check_service_health(name, config))
                
            service_results = await asyncio.gather(*service_checks)
            
            # Update service states
            for result in service_results:
                system_state['services'][result['name']] = result
                
            # Check infrastructure
            system_state['database'] = await self.check_database_health()
            system_state['redis'] = await self.check_redis_health()
            
            # Get metrics
            system_state['metrics'] = await self.get_system_metrics()
            
            # Generate alerts
            self.generate_alerts()
            
            system_state['last_update'] = datetime.utcnow().isoformat()
            
            # Wait before next check
            await asyncio.sleep(10)
            
    def generate_alerts(self):
        """Generate alerts based on system state"""
        alerts = []
        
        # Check for down services
        for name, state in system_state['services'].items():
            if state['status'] != 'healthy' and state['critical']:
                alerts.append({
                    'level': 'critical',
                    'service': name,
                    'message': f"Critical service {name} is {state['status']}",
                    'timestamp': datetime.utcnow().isoformat()
                })
                
        # Check database
        if system_state.get('database', {}).get('status') != 'healthy':
            alerts.append({
                'level': 'critical',
                'service': 'database',
                'message': 'Database is unhealthy',
                'timestamp': datetime.utcnow().isoformat()
            })
            
        # Check Redis
        if system_state.get('redis', {}).get('status') != 'healthy':
            alerts.append({
                'level': 'critical',
                'service': 'redis',
                'message': 'Redis is unhealthy',
                'timestamp': datetime.utcnow().isoformat()
            })
            
        # Check transaction success rate
        success_rate = system_state.get('metrics', {}).get('success_rate', 100)
        if success_rate < 95:
            alerts.append({
                'level': 'warning',
                'service': 'transactions',
                'message': f'Transaction success rate is {success_rate}%',
                'timestamp': datetime.utcnow().isoformat()
            })
            
        system_state['alerts'] = alerts
        
    def run(self):
        """Run monitor in background"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self.monitor_loop())


# Flask routes
@app.route('/')
def dashboard():
    """Render dashboard HTML"""
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Wakala System Health Dashboard</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            h1 { color: #333; }
            .container { max-width: 1200px; margin: 0 auto; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
            .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .service { display: flex; justify-content: space-between; align-items: center; padding: 10px; margin: 5px 0; border-radius: 4px; }
            .healthy { background: #d4edda; color: #155724; }
            .unhealthy { background: #f8d7da; color: #721c24; }
            .unreachable { background: #fff3cd; color: #856404; }
            .metric { font-size: 24px; font-weight: bold; color: #007bff; }
            .alert { padding: 10px; margin: 5px 0; border-radius: 4px; }
            .critical { background: #f8d7da; color: #721c24; }
            .warning { background: #fff3cd; color: #856404; }
            .timestamp { color: #666; font-size: 12px; }
        </style>
        <script>
            function updateDashboard() {
                fetch('/api/health')
                    .then(response => response.json())
                    .then(data => {
                        // Update services
                        const servicesHtml = Object.values(data.services).map(service => `
                            <div class="service ${service.status}">
                                <span>${service.name}</span>
                                <span>${service.status}</span>
                            </div>
                        `).join('');
                        document.getElementById('services').innerHTML = servicesHtml;
                        
                        // Update metrics
                        document.getElementById('transactions').innerHTML = data.metrics.total_transactions || 0;
                        document.getElementById('success-rate').innerHTML = (data.metrics.success_rate || 0) + '%';
                        document.getElementById('active-users').innerHTML = data.metrics.active_users || 0;
                        
                        // Update alerts
                        const alertsHtml = data.alerts.map(alert => `
                            <div class="alert ${alert.level}">
                                <strong>${alert.service}:</strong> ${alert.message}
                            </div>
                        `).join('');
                        document.getElementById('alerts').innerHTML = alertsHtml || '<p>No active alerts</p>';
                        
                        // Update timestamp
                        document.getElementById('last-update').innerHTML = new Date(data.last_update).toLocaleString();
                    });
            }
            
            // Update every 5 seconds
            setInterval(updateDashboard, 5000);
            updateDashboard();
        </script>
    </head>
    <body>
        <div class="container">
            <h1>Wakala System Health Dashboard</h1>
            
            <div class="grid">
                <div class="card">
                    <h2>Services</h2>
                    <div id="services">Loading...</div>
                </div>
                
                <div class="card">
                    <h2>Metrics</h2>
                    <p>Total Transactions: <span class="metric" id="transactions">-</span></p>
                    <p>Success Rate: <span class="metric" id="success-rate">-</span></p>
                    <p>Active Users: <span class="metric" id="active-users">-</span></p>
                </div>
                
                <div class="card">
                    <h2>Active Alerts</h2>
                    <div id="alerts">Loading...</div>
                </div>
            </div>
            
            <p class="timestamp">Last updated: <span id="last-update">-</span></p>
        </div>
    </body>
    </html>
    '''

@app.route('/api/health')
def api_health():
    """Return system health as JSON"""
    return jsonify(system_state)

@app.route('/metrics')
def metrics():
    """Prometheus metrics endpoint"""
    return generate_latest(), 200, {'Content-Type': CONTENT_TYPE_LATEST}


if __name__ == '__main__':
    # Start health monitor in background
    monitor = HealthMonitor()
    monitor_thread = threading.Thread(target=monitor.run)
    monitor_thread.daemon = True
    monitor_thread.start()
    
    # Start Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)