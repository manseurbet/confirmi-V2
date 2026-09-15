import React from 'react';
import { motion } from 'framer-motion';
import { PackageX, TrendingDown } from 'lucide-react';

export default function Scene0_Intro() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center text-center px-10"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: "blur(10px)", scale: 1.1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex gap-12 mb-10">
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 20 }}
          className="bg-red-500/10 p-8 rounded-3xl border border-red-500/20"
        >
          <PackageX size={80} className="text-red-500" />
        </motion.div>
        
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, type: "spring", stiffness: 300, damping: 20 }}
          className="bg-orange-500/10 p-8 rounded-3xl border border-orange-500/20 mt-12"
        >
          <TrendingDown size={80} className="text-orange-500" />
        </motion.div>
      </div>

      <motion.h1 
        className="text-5xl md:text-7xl font-bold mb-6 tracking-tight leading-tight"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.8 }}
      >
        Livraisons <span className="text-red-400">sans confirmation</span> = <br/>
        Pertes d'argent.
      </motion.h1>

      <motion.p
        className="text-2xl text-slate-400 font-arabic max-w-2xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 1 }}
      >
        مشكلة المتاجر الإلكترونية في الجزائر: الطلبيات الوهمية والروتور
      </motion.p>
    </motion.div>
  );
}