import os
import subprocess
import asyncio
import json
import random
import shutil
import threading
import time
import zipfile
from datetime import datetime, timedelta, timezone
import queue as thread_queue
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel

app = FastAPI(title="Fly Backup Local API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class BackupRequest(BaseModel):
    app_name: str = "zeus-basedatos"
    destination_path: str
    fly_token: str = None

@app.get("/debug/env")
def debug_env():
    return {
        "has_token": bool(os.getenv("FLY_API_TOKEN")),
        "token_preview": os.getenv("FLY_API_TOKEN", "")[:10],
        "path": os.getenv("PATH")
    }


@app.post("/test-fly-connection")
def test_fly_connection(body: BackupRequest):
    """Prueba la conexión real con Fly.io ejecutando un comando simple."""
    token = (body.fly_token or os.getenv("FLY_API_TOKEN", "")).strip()
    if not token:
        return {"ok": False, "error": "No hay token configurado"}
    
    # Intentamos obtener información de la app (fly status --app name)
    # Es un comando rápido que valida el token y el nombre de la app
    command = ["fly", "status", "--app", body.app_name, "--json"]
    
    env = os.environ.copy()
    env["FLY_API_TOKEN"] = token
    
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            env=env,
            timeout=15
        )
        if result.returncode == 0:
            return {"ok": True, "message": f"Conexión exitosa con {body.app_name}"}
        else:
            error_msg = result.stderr.strip()
            if "401" in error_msg or "unauthorized" in error_msg.lower():
                return {"ok": False, "error": "Token inválido (401 Unauthorized)"}
            if "could not find app" in error_msg.lower():
                return {"ok": False, "error": f"No se encontró la app '{body.app_name}'"}
            return {"ok": False, "error": error_msg[:100]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/list-backups")
def list_backups(destination_path: str):
    """Lista los archivos backup_*.zip en la carpeta de destino y el espacio total."""
    if not destination_path or not destination_path.strip():
        return {"files": [], "totalSize": 0}
    try:
        path = _resolve_destination_path(destination_path)
    except ValueError:
        return {"files": [], "totalSize": 0}
    if not os.path.isdir(path):
        return {"files": [], "totalSize": 0}
    files = []
    total_size = 0
    try:
        for name in os.listdir(path):
            if name.startswith("backup_") and name.endswith(".zip"):
                full = os.path.join(path, name)
                try:
                    stat = os.stat(full)
                    size = stat.st_size
                    total_size += size
                    mtime = stat.st_mtime
                    # Use UTC for standard ISO 8601 with "Z"
                    created = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z")
                    files.append({"name": name, "size": size, "createdAt": created})
                except OSError:
                    continue
        files.sort(key=lambda x: x["createdAt"], reverse=True)
    except OSError:
        return {"files": [], "totalSize": 0}
    return {"files": files, "totalSize": total_size}


class DeleteBackupRequest(BaseModel):
    destination_path: str
    file_name: str


class CleanupRetentionRequest(BaseModel):
    destination_path: str
    retention_days: int = 30


@app.post("/cleanup-retention")
def cleanup_retention(body: CleanupRetentionRequest):
    """Elimina backups backup_*.zip más antiguos que retention_days (por fecha de creación)."""
    if body.retention_days < 1:
        raise HTTPException(400, "retention_days debe ser >= 1")
    try:
        dest_path = _resolve_destination_path(body.destination_path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not os.path.isdir(dest_path):
        raise HTTPException(404, "Carpeta de destino no encontrada")
    cutoff = datetime.now() - timedelta(days=body.retention_days)
    cutoff_ts = cutoff.timestamp()
    deleted = []
    try:
        for name in os.listdir(dest_path):
            if name.startswith("backup_") and name.endswith(".zip"):
                full = os.path.join(dest_path, name)
                try:
                    mtime = os.path.getmtime(full)
                    if mtime < cutoff_ts:
                        os.remove(full)
                        deleted.append(name)
                except OSError:
                    continue
    except OSError as e:
        raise HTTPException(500, str(e))
    return {"ok": True, "deleted": deleted, "count": len(deleted)}


@app.post("/delete-backup")
def delete_backup(body: DeleteBackupRequest):
    """Elimina un archivo backup_*.zip de la carpeta de destino."""
    if not body.destination_path or not body.file_name:
        raise HTTPException(400, "destination_path y file_name requeridos")
    if not body.file_name.startswith("backup_") or not body.file_name.endswith(".zip"):
        raise HTTPException(400, "Solo se pueden eliminar archivos backup_*.zip")
    try:
        path = _resolve_destination_path(body.destination_path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not os.path.isdir(path):
        raise HTTPException(404, "Carpeta de destino no encontrada")
    full = os.path.join(path, body.file_name)
    if not os.path.isfile(full):
        raise HTTPException(404, "Archivo no encontrado")
    try:
        os.remove(full)
    except OSError as e:
        raise HTTPException(500, str(e))
    return {"ok": True, "deleted": body.file_name}


@app.get("/download-backup")
def download_backup(destination_path: str, file_name: str):
    """Descarga un archivo backup_*.zip."""
    try:
        path = _resolve_destination_path(destination_path)
        full_path = os.path.join(path, file_name)
        if not os.path.isfile(full_path):
            raise HTTPException(404, "Archivo no encontrado")
        # Devolver el archivo para descarga directa
        return FileResponse(
            path=full_path,
            filename=file_name,
            media_type='application/zip'
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/backup-details")
def backup_details(destination_path: str, file_name: str):
    """Obtiene detalles de un archivo backup_*.zip."""
    try:
        path = _resolve_destination_path(destination_path)
        full_path = os.path.join(path, file_name)
        if not os.path.isfile(full_path):
            raise HTTPException(404, "Archivo no encontrado")
        
        stat = os.stat(full_path)
        
        # Intentar leer metadatos del archivo JSON asociado
        metadata = {}
        metadata_path = full_path.replace(".zip", ".json")
        if os.path.isfile(metadata_path):
            try:
                with open(metadata_path, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
            except Exception as e:
                print(f"Error reading metadata for {file_name}: {e}")

        # Intentar leer contenido del zip para dar más detalles
        files_inside = []
        total_files = 0
        try:
            with zipfile.ZipFile(full_path, 'r') as z:
                # Mostrar solo los primeros 15 archivos como vista previa
                files_inside = [info.filename for info in z.infolist()[:15]]
                total_files = len(z.infolist())
        except:
            pass

        return {
            "name": file_name,
            "size": metadata.get("size", stat.st_size),
            "created_at": metadata.get("created_at", datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z")),
            "path": full_path,
            "total_files": total_files,
            "preview_files": files_inside,
            "duration_seconds": metadata.get("duration_seconds", None)
        }
    except Exception as e:
        raise HTTPException(500, str(e))


def _resolve_destination_path(destination_path: str) -> str:
    """Resuelve la ruta de destino: si es relativa, se interpreta respecto a la raíz del proyecto (no a la carpeta de la API)."""
    dest = destination_path.strip()
    if not dest:
        raise ValueError("Ruta de destino vacía")
    if os.path.isabs(dest):
        return os.path.abspath(dest)
    # Ruta relativa: respecto a la raíz del proyecto (carpeta padre de Api_Pocket_Base_Backup)
    api_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(api_dir)
    return os.path.abspath(os.path.join(project_root, dest))


@app.post("/backup-stream")
async def backup_stream(body: BackupRequest):
    token = (body.fly_token or os.getenv("FLY_API_TOKEN", "")).strip()
    if not token:
        raise HTTPException(500, "FLY_API_TOKEN not set. Por favor, ingréselo en la configuración.")

    # Log de depuración para la consola de la API
    print(f"\n--- NUEVO INTENTO DE BACKUP ---")
    print(f"App: {body.app_name}")
    print(f"Token (comienzo): {token[:10]}...")
    print(f"Longitud: {len(token)} caracteres")

    # Use short paths; keep plain paths for subprocess, long-path prefix for our file ops
    temp_plain = os.path.abspath("C:/pb_tmp") if os.name == "nt" else os.path.join(os.path.expanduser("~"), "temp_pb_backup")
    try:
        final_plain = _resolve_destination_path(body.destination_path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    temp_destination = temp_plain
    final_destination = final_plain
    if os.name == "nt":
        if not temp_destination.startswith("\\\\?\\"):
            temp_destination = "\\\\?\\" + temp_destination
        if not final_destination.startswith("\\\\?\\"):
            final_destination = "\\\\?\\" + final_destination
    
    # Clean up any existing temp directory
    if os.path.exists(temp_destination):
        import shutil
        try:
            shutil.rmtree(temp_destination)
        except FileNotFoundError:
            # Directory doesn't exist, that's fine
            pass
        except Exception as e:
            # Log the error but continue
            print(f"Warning: Could not remove temp directory: {e}")
    
    os.makedirs(temp_destination, exist_ok=True)

    async def event_generator():
        start_time = time.monotonic()
        # Send initial status
        yield f"data: {json.dumps({'status': 'starting', 'progress': 0, 'message': 'Iniciando backup...'})}\n\n"
        await asyncio.sleep(0.5)
        
        yield f"data: {json.dumps({'status': 'connecting', 'progress': 10, 'message': 'Conectando con la API...'})}\n\n"
        await asyncio.sleep(1)
        
        yield f"data: {json.dumps({'status': 'validating', 'progress': 20, 'message': 'Validando credenciales...'})}\n\n"
        await asyncio.sleep(1)
        
        yield f"data: {json.dumps({'status': 'transferring', 'progress': 30, 'message': 'Iniciando transferencia de datos...'})}\n\n"
        await asyncio.sleep(2)
        
        # Execute the actual backup command (streaming stdout/stderr to the client)
        command = [
            "fly",
            "ssh",
            "sftp",
            "get",
            "/pb_data",
            "--recursive",
            "--app",
            body.app_name
        ]
        
        yield f"data: {json.dumps({'status': 'processing', 'progress': 50, 'message': 'Transfiriendo archivos...'})}\n\n"
        
        try:
            import shutil
            pb_data_path = os.path.join(temp_destination, "pb_data")
            if os.path.exists(pb_data_path):
                shutil.rmtree(pb_data_path)
                yield f"data: {json.dumps({'status': 'processing', 'progress': 45, 'message': 'Limpiando directorio anterior...'})}\n\n"
                await asyncio.sleep(1)
            
            # Ejecutar fly en subproceso y leer stdout en un HILO separado.
            # Se le pasa el token a través de múltiples variables de entorno para mayor seguridad.
            env = os.environ.copy()
            env["FLY_API_TOKEN"] = token
            env["FLY_TOKEN"] = token
            env["FLY_ACCESS_TOKEN"] = token
            
            process = subprocess.Popen(
                command,
                cwd=temp_plain,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=False,
                bufsize=1,
                env=env,
            )
            log_queue = thread_queue.Queue()
            collected_lines = []

            def read_stdout_thread():
                try:
                    for line in iter(process.stdout.readline, b""):
                        try:
                            text = line.decode("utf-8", errors="replace").rstrip()
                        except Exception:
                            text = line.decode("latin-1", errors="replace").rstrip()
                        collected_lines.append(text)
                        log_queue.put(("log", text))
                    log_queue.put(("eof", None))
                except Exception as e:
                    log_queue.put(("log", f"[lectura: {e}]"))
                    log_queue.put(("eof", None))

            reader = threading.Thread(target=read_stdout_thread, daemon=True)
            reader.start()
            progress = 50
            loop = asyncio.get_event_loop()
            last_progress_send = time.monotonic()

            def get_log(timeout=0.3):
                try:
                    return log_queue.get(timeout=timeout)
                except thread_queue.Empty:
                    return None

            # Enviar líneas al cliente; si el cliente va lento, el hilo sigue leyendo
            while True:
                item = await loop.run_in_executor(None, lambda t=0.25: get_log(t))
                if item is not None:
                    kind, payload = item
                    if kind == "eof":
                        break
                    if kind == "log":
                        yield f"data: {json.dumps({'type': 'log', 'line': payload}, ensure_ascii=False)}\n\n"
                if process.poll() is not None:
                    break
                progress = min(progress + 2, 85)
                now = time.monotonic()
                if now - last_progress_send >= 1.0:
                    last_progress_send = now
                    yield f"data: {json.dumps({'status': 'processing', 'progress': progress, 'message': 'Transfiriendo archivos...'})}\n\n"

            # Vaciar cola restante
            while True:
                item = await loop.run_in_executor(None, lambda t=0.1: get_log(t))
                if item is None:
                    break
                kind, payload = item
                if kind == "eof":
                    break
                if kind == "log":
                    yield f"data: {json.dumps({'type': 'log', 'line': payload}, ensure_ascii=False)}\n\n"

            reader.join(timeout=2)
            process.wait()
            stdout = "\n".join(collected_lines)
            stderr = stdout

            if process.returncode == 0:
                # Crear un .zip con nombre único en la carpeta de destino (se acumulan, no se sobrescribe)
                try:
                    yield f"data: {json.dumps({'status': 'processing', 'progress': 95, 'message': 'Creando archivo zip...'})}\n\n"
                    
                    os.makedirs(final_plain, exist_ok=True)
                    
                    # Nombre único: backup_2026-01-31_10-53-57_057.zip
                    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                    suffix = str(random.randint(0, 999)).zfill(3)
                    zip_name = f"backup_{ts}_{suffix}.zip"
                    zip_path = os.path.join(final_plain, zip_name)
                    
                    # Comprimir la carpeta pb_data en el .zip
                    # En Windows usar ruta larga (\\?\) para poder leer paths > 260 caracteres (WinError 3)
                    if os.name == "nt":
                        pb_data_to_walk = os.path.join(temp_destination, "pb_data")
                    else:
                        pb_data_to_walk = os.path.join(temp_plain, "pb_data")
                    base_len = len(pb_data_to_walk.rstrip(os.sep)) + 1
                    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                        for root, dirs, files in os.walk(pb_data_to_walk):
                            for f in files:
                                full = os.path.join(root, f)
                                rel = full[base_len:] if len(full) > base_len else f
                                rel_norm = rel.replace("\\", "/")
                                arcname = "pb_data/" + rel_norm
                                zf.write(full, arcname)
                    
                    # Limpiar directorio temporal
                    shutil.rmtree(temp_destination, ignore_errors=True)
                    
                    end_time = time.monotonic()
                    duration_seconds = round(end_time - start_time)

                    # Guardar metadatos en un archivo JSON
                    metadata_name = zip_name.replace(".zip", ".json")
                    metadata_path = os.path.join(final_plain, metadata_name)
                    metadata_content = {
                        "duration_seconds": duration_seconds,
                        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), # Use UTC for accurate representation
                        "file_name": zip_name,
                        "size": os.path.getsize(zip_path)
                    }
                    with open(metadata_path, "w", encoding="utf-8") as f:
                        json.dump(metadata_content, f, ensure_ascii=False, indent=2)

                    yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Backup completado exitosamente!', 'result': {'app': body.app_name, 'destination': final_plain, 'file': zip_name, 'duration_seconds': duration_seconds}})}\n\n"
                except Exception as zip_error:
                    msg = str(zip_error)
                    if "206" in msg or "filename or extension is too long" in msg or "path" in msg.lower():
                        msg = f"Error de ruta al crear zip en {body.destination_path}: {msg}"
                    yield f"data: {json.dumps({'status': 'failed', 'progress': 0, 'message': f'Error creando zip: {msg}'})}\n\n"
            else:
                # Capturar el error real de Fly.io
                error_message = stderr.strip()
                detail = {
                    'stderr': error_message,
                    'stdout': stdout,
                    'returncode': process.returncode,
                    'app': body.app_name
                }
                
                # Identificar errores comunes para dar mejores mensajes
                if "401" in error_message or "unauthorized" in error_message.lower():
                    friendly_message = "Error de Autenticación (401): El Token de Fly.io es inválido o ha caducado."
                elif "not found" in error_message.lower():
                    friendly_message = f"La aplicación '{body.app_name}' no fue encontrada en Fly.io."
                else:
                    friendly_message = f"Error de Fly.io: {error_message[:100]}..."

                yield f"data: {json.dumps({'status': 'failed', 'progress': 0, 'message': friendly_message, 'detail': detail})}\n\n"
                
        except Exception as e:
            # Clean up temp directory on error
            try:
                import shutil
                if 'temp_destination' in locals() and os.path.exists(temp_destination):
                    shutil.rmtree(temp_destination, ignore_errors=True)
            except:
                pass
            
            error_msg = str(e)
            try:
                print("BACKUP_FAIL_DETAIL_OUTER", json.dumps({
                    'error': error_msg,
                    'temp_plain': temp_plain if 'temp_plain' in locals() else None,
                    'final_plain': final_plain if 'final_plain' in locals() else None,
                    'temp': temp_destination if 'temp_destination' in locals() else None,
                    'final': final_destination if 'final_destination' in locals() else None,
                    'app': body.app_name
                }, ensure_ascii=False))
            except Exception:
                pass
            if "The system cannot find the path specified" in error_msg or "WinError 3" in error_msg:
                error_msg = f"Error de ruta (outer): {error_msg}. Destino: {body.destination_path} | temp={temp_plain} final={final_plain}"
            elif "filename or extension is too long" in error_msg:
                error_msg = f"Nombre de archivo demasiado largo. Destino: {body.destination_path}. | temp={temp_plain} final={final_plain}"
            
            yield f"data: {json.dumps({'status': 'failed', 'progress': 0, 'message': f'Error: {error_msg}'})}\n\n"
        
        # End the stream
        yield "data: {\"status\": \"finished\"}\n\n"
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/backup")
def backup(body: BackupRequest):
    token = body.fly_token or os.getenv("FLY_API_TOKEN")
    if not token:
        raise HTTPException(500, "FLY_API_TOKEN no está configurado.")

    os.makedirs(body.destination_path, exist_ok=True)

    command = [
        "fly",
        "ssh",
        "sftp",
        "get",
        "/pb_data",
        "--recursive",
        "--app",
        body.app_name
    ]

    env = os.environ.copy()
    env["FLY_API_TOKEN"] = token
    result = subprocess.run(
        command,
        cwd=body.destination_path,
        capture_output=True,
        text=True,
        timeout=1800,
        env=env
    )

    if result.returncode != 0:
        raise HTTPException(500, result.stderr)

    return {
        "status": "ok",
        "app": body.app_name,
        "destination": body.destination_path
    }


# uvicorn main:app --host 127.0.0.1 --port 8000

# node cors-test-server.js