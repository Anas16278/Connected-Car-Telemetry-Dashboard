from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
import uuid
from datetime import datetime, timezone
import asyncio
import json
import random
import math
import pandas as pd
import io
from typing import AsyncGenerator

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="Connected Car Telemetry Dashboard", version="1.0.0")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except:
                pass

manager = ConnectionManager()

# Define Models
class Vehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    model: str
    year: int
    license_plate: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class VehicleCreate(BaseModel):
    name: str
    model: str
    year: int
    license_plate: str

class TelemetryData(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    vehicle_id: str
    speed: float  # km/h
    engine_rpm: float  # RPM
    fuel_level: float  # percentage
    engine_temperature: float  # Celsius
    latitude: float
    longitude: float
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TelemetryAlert(BaseModel):
    vehicle_id: str
    metric: str
    value: float
    threshold: float
    severity: str  # low, medium, high
    message: str

# Telemetry thresholds for alerts
TELEMETRY_THRESHOLDS = {
    "speed": {"max": 120, "min": 0},  # km/h
    "engine_rpm": {"max": 6000, "min": 800},  # RPM
    "fuel_level": {"max": 100, "min": 10},  # percentage
    "engine_temperature": {"max": 100, "min": 80}  # Celsius
}

# Vehicle simulation state
vehicle_states: Dict[str, Dict] = {}

def initialize_vehicle_state(vehicle_id: str) -> Dict:
    """Initialize realistic vehicle telemetry state"""
    base_lat, base_lng = 37.7749, -122.4194  # San Francisco base coordinates
    return {
        "speed": random.uniform(60, 80),
        "engine_rpm": random.uniform(1500, 2500),
        "fuel_level": random.uniform(50, 100),
        "engine_temperature": random.uniform(85, 95),
        "latitude": base_lat + random.uniform(-0.1, 0.1),
        "longitude": base_lng + random.uniform(-0.1, 0.1),
        "direction": random.uniform(0, 360),
        "last_update": datetime.now(timezone.utc)
    }

def simulate_realistic_telemetry(vehicle_id: str, state: Dict) -> TelemetryData:
    """Generate realistic telemetry data with smooth transitions"""
    current_time = datetime.now(timezone.utc)
    time_diff = (current_time - state["last_update"]).total_seconds()
    
    # Speed simulation with traffic patterns
    speed_change = random.uniform(-5, 5) * time_diff
    state["speed"] = max(0, min(140, state["speed"] + speed_change))
    
    # RPM correlates with speed
    target_rpm = state["speed"] * 35 + random.uniform(-200, 200)
    state["engine_rpm"] = max(800, min(6500, target_rpm))
    
    # Fuel consumption based on speed and RPM
    fuel_consumption_rate = (state["speed"] * 0.001 + state["engine_rpm"] * 0.0001) * time_diff
    state["fuel_level"] = max(0, state["fuel_level"] - fuel_consumption_rate)
    
    # Engine temperature simulation
    temp_target = 90 + (state["engine_rpm"] - 2000) * 0.005
    temp_change = (temp_target - state["engine_temperature"]) * 0.1 * time_diff
    state["engine_temperature"] = max(70, min(120, state["engine_temperature"] + temp_change))
    
    # GPS movement simulation
    movement_distance = state["speed"] * time_diff / 3600 / 111  # rough degree conversion
    angle_rad = math.radians(state["direction"])
    state["latitude"] += movement_distance * math.cos(angle_rad)
    state["longitude"] += movement_distance * math.sin(angle_rad)
    
    # Occasional direction changes
    if random.random() < 0.1:
        state["direction"] += random.uniform(-30, 30)
        state["direction"] = state["direction"] % 360
    
    state["last_update"] = current_time
    
    return TelemetryData(
        vehicle_id=vehicle_id,
        speed=round(state["speed"], 1),
        engine_rpm=round(state["engine_rpm"], 0),
        fuel_level=round(state["fuel_level"], 1),
        engine_temperature=round(state["engine_temperature"], 1),
        latitude=round(state["latitude"], 6),
        longitude=round(state["longitude"], 6),
        timestamp=current_time
    )

def check_telemetry_alerts(telemetry: TelemetryData) -> List[TelemetryAlert]:
    """Check telemetry data against thresholds and generate alerts"""
    alerts = []
    
    for metric, thresholds in TELEMETRY_THRESHOLDS.items():
        value = getattr(telemetry, metric)
        
        if value > thresholds["max"]:
            severity = "high" if value > thresholds["max"] * 1.2 else "medium"
            alerts.append(TelemetryAlert(
                vehicle_id=telemetry.vehicle_id,
                metric=metric,
                value=value,
                threshold=thresholds["max"],
                severity=severity,
                message=f"{metric.replace('_', ' ').title()} is critically high: {value}"
            ))
        elif value < thresholds["min"]:
            severity = "high" if value < thresholds["min"] * 0.8 else "medium"
            alerts.append(TelemetryAlert(
                vehicle_id=telemetry.vehicle_id,
                metric=metric,
                value=value,
                threshold=thresholds["min"],
                severity=severity,
                message=f"{metric.replace('_', ' ').title()} is critically low: {value}"
            ))
    
    return alerts

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Connected Car Telemetry Dashboard API"}

@api_router.post("/vehicles", response_model=Vehicle)
async def create_vehicle(vehicle_data: VehicleCreate):
    """Create a new vehicle"""
    vehicle_dict = vehicle_data.dict()
    vehicle = Vehicle(**vehicle_dict)
    
    # Store in database
    result = await db.vehicles.insert_one(vehicle.dict())
    
    # Initialize simulation state
    vehicle_states[vehicle.id] = initialize_vehicle_state(vehicle.id)
    
    return vehicle

@api_router.get("/vehicles", response_model=List[Vehicle])
async def get_vehicles():
    """Get all vehicles"""
    vehicles = await db.vehicles.find({"is_active": True}).to_list(100)
    return [Vehicle(**vehicle) for vehicle in vehicles]

@api_router.get("/vehicles/{vehicle_id}", response_model=Vehicle)
async def get_vehicle(vehicle_id: str):
    """Get specific vehicle"""
    vehicle = await db.vehicles.find_one({"id": vehicle_id})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return Vehicle(**vehicle)

@api_router.put("/vehicles/{vehicle_id}", response_model=Vehicle)
async def update_vehicle(vehicle_id: str, vehicle_data: VehicleCreate):
    """Update vehicle information"""
    vehicle_dict = vehicle_data.dict()
    vehicle_dict["id"] = vehicle_id
    
    result = await db.vehicles.update_one(
        {"id": vehicle_id}, 
        {"$set": vehicle_dict}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    updated_vehicle = await db.vehicles.find_one({"id": vehicle_id})
    return Vehicle(**updated_vehicle)

@api_router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str):
    """Delete a vehicle"""
    result = await db.vehicles.update_one(
        {"id": vehicle_id}, 
        {"$set": {"is_active": False}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    # Remove from simulation
    if vehicle_id in vehicle_states:
        del vehicle_states[vehicle_id]
    
    return {"message": "Vehicle deleted successfully"}

@api_router.get("/vehicles/{vehicle_id}/telemetry")
async def get_vehicle_telemetry(vehicle_id: str, limit: int = 100):
    """Get historical telemetry data for a vehicle"""
    telemetry_data = await db.telemetry.find(
        {"vehicle_id": vehicle_id}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    
    return [TelemetryData(**data) for data in telemetry_data]

@api_router.get("/vehicles/{vehicle_id}/telemetry/export")
async def export_vehicle_telemetry(vehicle_id: str, days: int = 7):
    """Export telemetry data as CSV"""
    from_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - pd.Timedelta(days=days)
    
    telemetry_data = await db.telemetry.find({
        "vehicle_id": vehicle_id,
        "timestamp": {"$gte": from_date}
    }).sort("timestamp", 1).to_list(10000)
    
    if not telemetry_data:
        raise HTTPException(status_code=404, detail="No telemetry data found")
    
    # Convert to DataFrame
    df = pd.DataFrame([
        {
            "timestamp": data["timestamp"],
            "vehicle_id": data["vehicle_id"],
            "speed_kmh": data["speed"],
            "engine_rpm": data["engine_rpm"],
            "fuel_level_percent": data["fuel_level"],
            "engine_temperature_celsius": data["engine_temperature"],
            "latitude": data["latitude"],
            "longitude": data["longitude"]
        }
        for data in telemetry_data
    ])
    
    # Convert to CSV
    csv_buffer = io.StringIO()
    df.to_csv(csv_buffer, index=False)
    csv_content = csv_buffer.getvalue()
    
    def generate_csv():
        yield csv_content
    
    return StreamingResponse(
        io.BytesIO(csv_content.encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=telemetry_{vehicle_id}_{days}days.csv"}
    )

# WebSocket endpoint for real-time telemetry
@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Generate telemetry for all active vehicles
            all_telemetry = []
            all_alerts = []
            
            # Get active vehicles
            vehicles = await db.vehicles.find({"is_active": True}).to_list(100)
            
            for vehicle_data in vehicles:
                vehicle_id = vehicle_data["id"]
                
                # Initialize state if not exists
                if vehicle_id not in vehicle_states:
                    vehicle_states[vehicle_id] = initialize_vehicle_state(vehicle_id)
                
                # Generate telemetry
                telemetry = simulate_realistic_telemetry(vehicle_id, vehicle_states[vehicle_id])
                
                # Store in database (optional, for historical data)
                await db.telemetry.insert_one(telemetry.dict())
                
                # Check for alerts
                alerts = check_telemetry_alerts(telemetry)
                all_alerts.extend(alerts)
                
                all_telemetry.append(telemetry.dict())
            
            # Send data to all connected clients
            message = {
                "type": "telemetry_update",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data": all_telemetry,
                "alerts": [alert.dict() for alert in all_alerts]
            }
            
            await manager.broadcast(message)
            await asyncio.sleep(1)  # Update every second
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelevel)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()