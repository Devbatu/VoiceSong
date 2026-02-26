"""
Demucs Audio Separation Service
Handles music source separation using Demucs models
"""
import os
import torch
from pathlib import Path
from typing import List, Optional
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DemucsService:
    """Service for audio source separation using Demucs"""
    
    def __init__(self, model_name: str = "htdemucs"):
        """
        Initialize Demucs service
        
        Args:
            model_name: Name of the Demucs model to use
                       Options: htdemucs, htdemucs_ft, htdemucs_6s, mdx_extra
        """
        self.model_name = model_name
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        logger.info(f"DemucsService initialized with model: {model_name} on {self.device}")
    
    def load_model(self):
        """Load the Demucs model"""
        try:
            from demucs.pretrained import get_model
            from demucs.apply import apply_model
            
            self.model = get_model(self.model_name)
            self.model.to(self.device)
            self.apply_model = apply_model
            logger.info(f"Model {self.model_name} loaded successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False
    
    def separate(
        self,
        audio_path: str,
        output_dir: str,
        stems: Optional[List[str]] = None
    ) -> dict:
        """
        Separate audio into stems
        
        Args:
            audio_path: Path to input audio file
            output_dir: Directory to save separated stems
            stems: List of stems to extract (None = all stems)
        
        Returns:
            Dictionary with paths to separated stems
        """
        try:
            import torchaudio
            from demucs.audio import AudioFile, save_audio
            
            # Load model if not already loaded
            if self.model is None:
                if not self.load_model():
                    raise Exception("Failed to load model")
            
            # Load audio
            audio_path = Path(audio_path)
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            
            logger.info(f"Loading audio from {audio_path}")
            wav, sr = torchaudio.load(str(audio_path))
            wav = wav.to(self.device)
            
            # Apply model
            logger.info("Applying separation model...")
            with torch.no_grad():
                sources = self.apply_model(
                    self.model,
                    wav.unsqueeze(0),
                    device=self.device,
                    shifts=1,
                    split=True,
                    overlap=0.25
                )[0]
            
            # Save separated stems
            stem_names = self.model.sources
            output_paths = {}
            
            logger.info(f"Saving {len(stem_names)} stems...")
            for i, stem_name in enumerate(stem_names):
                if stems is None or stem_name in stems:
                    stem_path = output_dir / f"{audio_path.stem}_{stem_name}.wav"
                    save_audio(
                        sources[i].cpu(),
                        str(stem_path),
                        sr,
                        clip="rescale"
                    )
                    output_paths[stem_name] = str(stem_path)
                    logger.info(f"Saved {stem_name} to {stem_path}")
            
            return {
                "status": "success",
                "stems": output_paths,
                "model": self.model_name,
                "sample_rate": sr
            }
        
        except Exception as e:
            logger.error(f"Separation failed: {e}")
            return {
                "status": "error",
                "error": str(e)
            }
    
    def get_available_stems(self) -> List[str]:
        """Get list of stems that can be separated by current model"""
        if self.model is None:
            self.load_model()
        
        if self.model:
            return list(self.model.sources)
        
        # Default stems for common models
        if "6s" in self.model_name:
            return ["vocals", "drums", "bass", "piano", "guitar", "other"]
        else:
            return ["vocals", "drums", "bass", "other"]


# Singleton instance
_demucs_service = None

def get_demucs_service(model_name: str = "htdemucs") -> DemucsService:
    """Get or create DemucsService instance"""
    global _demucs_service
    if _demucs_service is None or _demucs_service.model_name != model_name:
        _demucs_service = DemucsService(model_name)
    return _demucs_service
