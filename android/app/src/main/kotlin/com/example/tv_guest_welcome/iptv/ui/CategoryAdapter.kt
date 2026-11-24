package com.example.tv_guest_welcome.iptv.ui

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.tv_guest_welcome.R
import com.example.tv_guest_welcome.iptv.Category

class CategoryAdapter(
    private val onSelected: (Category) -> Unit
) : RecyclerView.Adapter<CategoryAdapter.VH>() {
    private val items = ArrayList<Category>()
    private var selectedIndex = 0

    fun submit(categories: List<Category>) {
        items.clear()
        items.addAll(categories)
        selectedIndex = 0
        notifyDataSetChanged()
        items.firstOrNull()?.let(onSelected)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_category, parent, false) as TextView
        return VH(view)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]
        holder.title.text = item.title
        val isSelected = position == selectedIndex
        holder.title.isSelected = isSelected
        holder.title.setTextColor(if (isSelected) Color.parseColor("#FBBF24") else Color.parseColor("#EAF0FF"))
        holder.title.setOnClickListener {
            select(position)
        }
        holder.title.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus) {
                holder.title.setTextColor(Color.parseColor("#FBBF24"))
                if (selectedIndex != position) select(position)
            } else {
                holder.title.setTextColor(if (position == selectedIndex) Color.parseColor("#FBBF24") else Color.parseColor("#EAF0FF"))
            }
        }
    }

    private fun select(position: Int) {
        if (position < 0 || position >= items.size) return
        val prev = selectedIndex
        selectedIndex = position
        if (prev != selectedIndex) {
            notifyItemChanged(prev)
            notifyItemChanged(selectedIndex)
        } else {
            notifyItemChanged(selectedIndex)
        }
        onSelected(items[selectedIndex])
    }

    override fun getItemCount(): Int = items.size

    class VH(val title: TextView) : RecyclerView.ViewHolder(title)
}

