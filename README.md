# ✈️ AI Aircraft Generator

SkyForge - Natural Language to 3D Aircraft Design - Built for Hack-Nation Global AI Hackathon 2025

## 🎯 What It Does

SkyForge transforms natural language descriptions into professional 3D aircraft components using Google Gemini AI. Simply describe what you want - "swept wing with 35 degree sweep, 12 meter span" - and watch it generate aerospace-grade 3D models with real NACA airfoil profiles.

## ✨ Features

- 🤖 **Natural Language Input** - Describe aircraft parts in plain English
- 🧠 **AI Parameter Extraction** - Google Gemini API interprets and extracts specifications
- ✈️ **3D Generation** - Creates wings, fuselages, and stabilizers with procedural geometry
- 📐 **NACA Airfoils** - Uses real aerospace engineering standards (4-digit NACA profiles)
- 📊 **Aerodynamic Metrics** - Calculates aspect ratio, taper ratio, and planform area
- 🛡️ **Safety Validation** - Checks designs against real aircraft specifications (A380, 747, Concorde)
- 📋 **Design Reports** - Generates certification-ready documentation
- 💾 **Export** - GLTF, STL, and GLB formats for CAD integration

## 🛠️ Tech Stack

- **AI:** Google Gemini API (natural language processing)
- **3D Engine:** Three.js r128
- **Frontend:** JavaScript, HTML5, CSS3
- **Standards:** NACA 4-digit airfoil geometry, aerospace engineering principles

## 🚀 Quick Start

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/ai-aircraft-generator.git
cd ai-aircraft-generator
```

2. Open `index.html` in a web browser

3. Enter your Gemini API key (get free key at: https://makersuite.google.com/app/apikey)

4. Try an example:
   - Type: "swept wing with 35 degree sweep, 12 meter span"
   - Click "Generate 3D Part"
   - View the 3D model and adjust parameters!

## 📚 How It Works

1. **Natural Language Input** → User describes aircraft part
2. **AI Extraction** → Gemini API parses description into structured parameters
3. **Validation** → Parameters checked against aerospace standards
4. **3D Generation** → Procedural geometry creates mesh using NACA airfoils
5. **Visualization** → Three.js renders interactive 3D model
6. **Export** → Model can be exported to CAD-compatible formats

## 🏆 Hackathon Details

**Event:** Hack-Nation Global AI Hackathon 2025  
**Challenge:** "From Sketch to Sky: AI-Assisted 3D Aircraft Design"  
**Track:** VC Big Bets  
**Date:** Nov 8-9, 2025

## 🔮 Future Improvements

- Multi-part assembly (wings + fuselage)
- CFD analysis integration
- Material specifications
- Cost estimation
- Collaborative design features

## 📄 License

MIT License - see LICENSE file for details

## 👤 Author

**Alexander Baker**  
B.S. Computer Science, University of Colorado Boulder  
[GitHub](https://github.com/Alexander-Baker-1) | [LinkedIn](https://www.linkedin.com/in/alexander-baker24/)

## 🙏 Acknowledgments

- Airbus A380 specifications (airbus.com)
- Boeing specifications (boeing.com)
- NASA Concorde technical data
- "Introduction to Flight" by John D. Anderson
- Hack-Nation organizers and mentors

---

Built with ❤️ for aerospace innovation