package com.example.tv_guest_welcome

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import androidx.appcompat.app.AppCompatActivity
import com.example.tv_guest_welcome.R

class SetupActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)

        val input = findViewById<EditText>(R.id.room_number_input)
        val button = findViewById<Button>(R.id.save_button)

        button.setOnClickListener {
            val roomNumber = input.text.toString().trim()
            if (roomNumber.isNotEmpty()) {
                val prefs = getSharedPreferences("TV_PREFS", Context.MODE_PRIVATE)
                prefs.edit().putString("room_number", roomNumber).apply()
                
                startActivity(Intent(this, MainActivity::class.java))
                finish()
            }
        }
    }
}
