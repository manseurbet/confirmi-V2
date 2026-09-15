import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Scene0_Intro from './scenes/Scene0_Intro';
import Scene1_Solution from './scenes/Scene1_Solution';
import Scene2_Flow from './scenes/Scene2_Flow';
import Scene3_Features from './scenes/Scene3_Features';
import Scene4_Outro from './scenes/Scene4_Outro';

const SCENE_DURATIONS = [6000, 4000, 12000, 8000, 6000];

export default function VideoTemplate() {
  const [currentScene, setCurrentScene] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentScene((prev) => (prev + 1) % SCENE_DURATIONS.length);
    }, SCENE_DURATIONS[currentScene]);

    return () => clearTimeout(timer);
  }, [currentScene]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0f172a] text-white flex items-center justify-center font-sans">
      
      {/* Persistent Background Elements */}
      <motion.div 
        className="absolute inset-0 bg-gradient-to-br from-[#1e293b]/50 to-[#0f172a]"
        animate={{
          backgroundPosition: currentScene % 2 === 0 ? ['0% 0%', '100% 100%'] : ['100% 100%', '0% 0%']
        }}
        transition={{ duration: SCENE_DURATIONS[currentScene] / 1000, ease: "linear" }}
      />
      
      {/* Decorative Blob */}
      <motion.div
        className="absolute rounded-full blur-[100px] opacity-30"
        style={{ backgroundColor: '#22c55e', width: '40vw', height: '40vw' }}
        animate={{
          x: currentScene === 0 ? '-10vw' : currentScene === 2 ? '50vw' : '80vw',
          y: currentScene === 1 ? '10vh' : currentScene === 3 ? '60vh' : '-20vh',
          scale: currentScene === 4 ? 2 : 1,
        }}
        transition={{ duration: 2, ease: "easeInOut" }}
      />

      <AnimatePresence mode="wait">
        {currentScene === 0 && <Scene0_Intro key="scene0" />}
        {currentScene === 1 && <Scene1_Solution key="scene1" />}
        {currentScene === 2 && <Scene2_Flow key="scene2" />}
        {currentScene === 3 && <Scene3_Features key="scene3" />}
        {currentScene === 4 && <Scene4_Outro key="scene4" />}
      </AnimatePresence>
    </div>
  );
}